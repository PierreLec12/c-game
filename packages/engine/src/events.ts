/**
 * The event library (section 5.4): each kind has a trigger (scheduled by the level), shocks to the
 * world and the factors, the news it emits, and whether the clock should pause. Leaks are scheduled a
 * day before their meeting and are right two times in three.
 */
import { FACTORS } from "./refdata";
import type { Stream } from "./rng";
import type { EngineEvent, ScheduledEvent, State } from "./types";
import { applyWorldShock } from "./world";
import { publishNews, resolveNews } from "./information";
import { dayOfTick } from "./calendar";

export interface EventDef {
  kind: string;
  title: string;
  card?: string; // concept card id it unlocks
  fire: (state: State, ev: ScheduledEvent, s: Stream) => EngineEvent[];
}

const num = (v: unknown, d: number): number => (typeof v === "number" ? v : d);
const str = (v: unknown, d: string): string => (typeof v === "string" ? v : d);

function jumpBrent(state: State, logMove: number): void {
  state.factors = { ...state.factors, brentPrompt: state.factors.brentPrompt * Math.exp(logMove) };
}

export const EVENT_LIBRARY: Record<string, EventDef> = {
  inventory_release: {
    kind: "inventory_release", title: "Weekly inventory release", card: "expected_vs_actual",
    fire(state, ev, s) {
      const rel = state.releases.find((r) => r.id === ev.id);
      const trueChange = (7 * 0.3 * state.world.crudeBalance) / 1000 + s.normal() * 2.5;
      const consensus = rel?.consensus?.v ?? (7 * 0.3 * state.world.targets.crudeBalance) / 1000;
      const actual = Math.round(trueChange * 10) / 10;
      const surprise = actual - consensus;
      const move = -FACTORS.releaseSurpriseElasticity.value * surprise;
      jumpBrent(state, move);
      state.world = applyWorldShock(state.world, { usInvGap: surprise * 0.5, eventIntensity: 0.15 });
      if (rel) { rel.actual = { v: actual, at: state.tick, why: `Weekly US crude stock change published at ${ev.tick}: the true weekly balance plus survey noise.` }; rel.published = true; }
      const dir = surprise > 0 ? "build" : "draw";
      const n = publishNews(state, { source: "release", headline: `Crude stocks ${actual >= 0 ? "+" : ""}${actual.toFixed(1)} mb versus ${consensus >= 0 ? "+" : ""}${consensus.toFixed(1)} expected`, body: `The weekly inventory report shows a ${actual >= 0 ? "build" : "draw"} of ${Math.abs(actual).toFixed(1)} mb against a consensus of ${consensus.toFixed(1)}. A ${Math.abs(surprise).toFixed(1)} mb surprise ${dir} is ${surprise > 0 ? "bearish" : "bullish"} for the prompt.`, eventId: ev.id });
      return [{ kind: "release", tick: state.tick, text: n.headline, pause: true, data: { actual, consensus, surprise } }];
    },
  },
  opec_meeting: {
    kind: "opec_meeting", title: "OPEC+ meeting", card: "rumour_base_rate",
    fire(state, ev) {
      const decision = str(ev.params.decision, "hold");
      const kbd = num(ev.params.kbd, 500);
      const delta = decision === "cut" ? -kbd : decision === "hike" ? kbd : 0;
      state.world = applyWorldShock(state.world, { crudeBalance: delta * 0.6, eventIntensity: 0.3, geo: decision === "cut" ? 0.05 : 0 }, { crudeBalance: state.world.targets.crudeBalance + delta });
      jumpBrent(state, decision === "cut" ? 0.02 : decision === "hike" ? -0.02 : 0.0);
      const text = decision === "cut" ? `OPEC+ agrees a ${kbd} kb/d cut` : decision === "hike" ? `OPEC+ raises output by ${kbd} kb/d` : "OPEC+ holds output steady";
      const n = publishNews(state, { source: "wire", headline: text, body: `The meeting ended with a decision to ${decision}. The balance shifts by ${delta} kb/d from next month; the prompt reprices on the headline.`, eventId: ev.id });
      // resolve the leak that preceded this meeting
      const leak = state.news.find((x) => x.eventId === `${ev.id}:leak`);
      if (leak && !leak.resolved) {
        const claimed = str(state.events.find((e) => e.id === `${ev.id}:leak`)?.params.claim, "");
        resolveNews(state, leak.id, claimed === decision ? "true" : "false", claimed === decision ? "The leak was right: the meeting confirmed it." : `The leak was wrong: sources said "${claimed}", the meeting decided "${decision}".`);
      }
      return [{ kind: "event", tick: state.tick, text: n.headline, pause: true, data: { decision, kbd } }];
    },
  },
  opec_leak: {
    kind: "opec_leak", title: "Leak before the meeting",
    fire(state, ev) {
      const claim = str(ev.params.claim, "hold");
      const kbd = num(ev.params.kbd, 500);
      const n = publishNews(state, { source: "leak", headline: `Sources: OPEC+ leaning towards ${claim === "cut" ? `a ${kbd} kb/d cut` : claim === "hike" ? `a ${kbd} kb/d increase` : "no change"}`, body: "Two delegates, speaking before tomorrow's meeting. Leaks of this kind have been right about two times in three. The market moves on it now and will move again on the decision.", eventId: ev.id });
      jumpBrent(state, claim === "cut" ? 0.012 : claim === "hike" ? -0.012 : 0);
      state.world = applyWorldShock(state.world, { eventIntensity: 0.15 });
      return [{ kind: "news", tick: state.tick, text: n.headline, pause: true, data: { claim } }];
    },
  },
  positioning_report: {
    kind: "positioning_report", title: "Weekly positioning report", card: "positioning_is_a_crowd",
    fire(state, ev, s) {
      const net = Math.round(200 + 150 * (state.factors.brentPrompt / 75 - 1) * 10 + s.normal() * 30);
      const n = publishNews(state, { source: "release", headline: `Managed money net long ${net}k lots of Brent`, body: `The weekly positioning report shows speculators net long ${net}k lots${net > 300 ? ", a crowded long: the exit is narrow if the prompt turns" : net < 120 ? ", a light book: there is room for buyers" : ""}.`, eventId: ev.id });
      state.world = applyWorldShock(state.world, { eventIntensity: 0.05 });
      return [{ kind: "release", tick: state.tick, text: n.headline, pause: false, data: { net } }];
    },
  },
  inventory_shock: {
    kind: "inventory_shock", title: "Inventory shock",
    fire(state, ev) {
      const us = num(ev.params.usInvGap, 0);
      const oecd = num(ev.params.oecdInvGap, 0);
      state.world = applyWorldShock(state.world, { usInvGap: us, oecdInvGap: oecd, eventIntensity: 0.2 });
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, "Stocks shift"), body: str(ev.params.body, `US stocks move by ${us} mb; OECD by ${oecd} mb.`), eventId: ev.id });
      return [{ kind: "event", tick: state.tick, text: n.headline, pause: true }];
    },
  },
  refinery_turnaround: {
    kind: "refinery_turnaround", title: "Refinery turnaround", card: "turnaround_is_supply",
    fire(state, ev) {
      const runs = num(ev.params.runs, -0.08);
      state.world = applyWorldShock(state.world, { eventIntensity: 0.15 }, { refineryRuns: state.world.targets.refineryRuns + runs });
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, "Refinery runs cut for maintenance"), body: str(ev.params.body, `Runs fall by ${Math.round(-runs * 100)}% of capacity for ${num(ev.params.days, 10)} days: less product made, cracks strengthen.`), eventId: ev.id });
      return [{ kind: "event", tick: state.tick, text: n.headline, pause: true }];
    },
  },
  turnaround_end: {
    kind: "turnaround_end", title: "Turnaround ends",
    fire(state, ev) {
      const runs = num(ev.params.runs, 0.08);
      state.world = applyWorldShock(state.world, {}, { refineryRuns: state.world.targets.refineryRuns + runs });
      const n = publishNews(state, { source: "wire", headline: "Refinery back from maintenance", body: "Runs return to normal; the crack premium fades.", eventId: ev.id });
      return [{ kind: "news", tick: state.tick, text: n.headline, pause: false }];
    },
  },
  headline_move: {
    kind: "headline_move", title: "Headline move",
    fire(state, ev) {
      const pct = num(ev.params.pct, -0.03);
      jumpBrent(state, Math.log(1 + pct));
      state.world = applyWorldShock(state.world, { eventIntensity: 0.25, geo: num(ev.params.geo, 0) });
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, "Prompt crude drops on a headline"), body: str(ev.params.body, `Brent moves ${(pct * 100).toFixed(1)}% in an hour.`), eventId: ev.id });
      return [{ kind: "event", tick: state.tick, text: n.headline, pause: true, data: { pct } }];
    },
  },
  balance_shift: {
    kind: "balance_shift", title: "Balance shifts",
    fire(state, ev) {
      const kbd = num(ev.params.kbd, 0);
      state.world = applyWorldShock(state.world, { eventIntensity: 0.1 }, { crudeBalance: state.world.targets.crudeBalance + kbd });
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, "Balance shifts"), body: str(ev.params.body, `The crude balance shifts by ${kbd} kb/d.`), eventId: ev.id });
      return [{ kind: "news", tick: state.tick, text: n.headline, pause: num(ev.params.pause, 1) === 1 }];
    },
  },
  rate_move: {
    kind: "rate_move", title: "Rate decision",
    fire(state, ev) {
      const bp = num(ev.params.bp, 25);
      state.world = { ...state.world, baseRate: state.world.baseRate + bp / 10000 };
      const n = publishNews(state, { source: "wire", headline: `Base rate ${bp > 0 ? "up" : "down"} ${Math.abs(bp)} bp`, body: `Financing on the line now costs ${((state.world.baseRate + 0.015) * 100).toFixed(2)}%. Full carry moves with it.`, eventId: ev.id });
      return [{ kind: "news", tick: state.tick, text: n.headline, pause: false }];
    },
  },
  geo_scare: {
    kind: "geo_scare", title: "Geopolitical scare",
    fire(state, ev) {
      const geo = num(ev.params.geo, 0.3);
      state.world = applyWorldShock(state.world, { geo, eventIntensity: 0.5 }, { geo: Math.min(1, state.world.targets.geo + geo * 0.5) });
      jumpBrent(state, 0.03);
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, "Tanker seized in the Gulf; risk premium jumps"), body: str(ev.params.body, "Vol doubles; the prompt gaps higher; the risk manager will be on the phone."), eventId: ev.id });
      return [{ kind: "event", tick: state.tick, text: n.headline, pause: true }];
    },
  },
};

/** Build the scheduled list from a level's schedule: leaks are added a day before meetings; turnarounds get an end. */
export function scheduleEvents(entries: { id?: string; kind: string; day: number; hour?: number; params?: Record<string, number | string | boolean> }[], s: Stream): ScheduledEvent[] {
  const out: ScheduledEvent[] = [];
  entries.forEach((e, i) => {
    const id = e.id ?? `ev${i + 1}`;
    const tick = e.day * 24 + (e.hour ?? 9);
    const params: Record<string, number | string | boolean> = { ...(e.params ?? {}) };
    if (e.kind === "opec_meeting") {
      if (params.decision === "random" || params.decision === undefined) params.decision = s.pick(["cut", "hike", "hold"]);
      const truthful = s.chance(2 / 3);
      const others = ["cut", "hike", "hold"].filter((d) => d !== params.decision);
      const claim = truthful ? String(params.decision) : s.pick(others);
      out.push({ id: `${id}:leak`, kind: "opec_leak", tick: tick - 24, fired: false, params: { claim, kbd: params.kbd ?? 500, truthful } });
    }
    if (e.kind === "refinery_turnaround") {
      const days = typeof params.days === "number" ? params.days : 10;
      out.push({ id: `${id}:end`, kind: "turnaround_end", tick: tick + days * 24, fired: false, params: { runs: -(typeof params.runs === "number" ? params.runs : -0.08) } });
    }
    out.push({ id, kind: e.kind, tick, fired: false, params });
  });
  return out.sort((a, b) => a.tick - b.tick);
}

/** Fire every event due at the current tick. */
export function fireDue(state: State, s: Stream): EngineEvent[] {
  const events: EngineEvent[] = [];
  for (const ev of state.events) {
    if (ev.fired || ev.tick !== state.tick) continue;
    const def = EVENT_LIBRARY[ev.kind];
    ev.fired = true;
    if (!def) continue;
    events.push(...def.fire(state, ev, s));
  }
  return events;
}

export function nextEventTick(state: State): number | null {
  const next = state.events.filter((e) => !e.fired && e.tick > state.tick).sort((a, b) => a.tick - b.tick)[0];
  return next ? next.tick : null;
}

export function levelDay(state: State): number {
  return dayOfTick(state.startDay, state.tick) - state.startDay;
}
