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
import { issueTender, type TenderTemplate } from "./counterparties";
import { rerouteAround } from "./voyages";
import { raiseQualityClaim, cancelCargo } from "./physical";
import { moveRating, sellerDefault } from "./counterparties";
import { CHOKEPOINT_SPECS, COUNTERPARTIES, GRADES, PORTS, type Grade } from "./world_data";
import { resolveNews as resolve } from "./information";
import type { WindowSpec } from "./types";
import { listedStrikes, makeOptionOrder } from "./optionbook";
import { fillOption } from "./actions";
import { monthLabel } from "./calendar";
const INSTRUMENTS_NAME: Record<string, string> = { WTI: "WTI", BRENT: "Brent", HH: "Henry Hub" };

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
      // the leak's pop unwinds if the leak was wrong
      const leakEv = state.events.find((e) => e.id === `${ev.id}:leak`);
      if (leakEv && leakEv.fired) {
        const claim = str(leakEv.params.claim, "hold");
        if (claim !== decision) jumpBrent(state, claim === "cut" ? -0.012 : claim === "hike" ? 0.012 : 0);
      }
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
      const crowded = ev.params.crowded === true;
      const net = crowded ? Math.round(400 + s.normal() * 20) : Math.round(200 + 150 * (state.factors.brentPrompt / 75 - 1) * 10 + s.normal() * 30);
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

  tender: {
    kind: "tender", title: "A tender arrives",
    fire(state, ev, s) {
      const p = ev.params;
      const window: WindowSpec = { kind: str(p.windowKind, "after_bl") as WindowSpec["kind"], days: num(p.windowDays, 5), deemedDay: typeof p.deemedDay === "number" ? p.deemedDay : undefined };
      const t = issueTender(state, {
        counterparty: str(p.counterparty, "NORTHSEA_MAJOR"), side: str(p.side, "offer") as "offer" | "bid", grade: str(p.grade, "FORTIES") as Grade, bbl: typeof p.bbl === "number" ? p.bbl : undefined,
        incoterm: str(p.incoterm, "FOB") as "FOB" | "CIF" | "DES", port: str(p.port, "SULLOM_VOE"), basis: typeof p.basis === "string" ? (p.basis as TenderTemplate["basis"]) : undefined, window,
        diffVsFair: num(p.diffVsFair, 0), laycanStart: num(p.laycanStart, 5), laycanDays: num(p.laycanDays, 2), openHours: num(p.openHours, 48), note: typeof p.note === "string" ? p.note : undefined, trap: typeof p.trap === "string" ? p.trap : undefined,
        requiresLc: p.requiresLc === true, prepayDiscount: num(p.prepayDiscount, 0),
      }, s);
      publishNews(state, { source: "wire", headline: `${t.side === "offer" ? "Offer" : "Bid"}: ${GRADES[t.grade].name} ${t.incoterm} ${PORTS[t.port].name} at ${t.basis} ${t.diff >= 0 ? "+" : ""}${t.diff.toFixed(2)}`, body: t.note, eventId: ev.id });
      return [{ kind: "tender", tick: state.tick, text: `${t.side === "offer" ? "Offer" : "Bid"} ${t.id}: ${t.note} Open ${Math.round((t.expiresTick - state.tick) / 24)} days.`, pause: true, data: { tenderId: t.id } }];
    },
  },
  chokepoint: {
    kind: "chokepoint", title: "Chokepoint status", card: "chokepoint_is_a_spread",
    fire(state, ev) {
      const id = str(ev.params.id, "BAB_EL_MANDEB");
      const status = str(ev.params.status, "restricted") as "open" | "restricted" | "closed";
      const spec = CHOKEPOINT_SPECS[id];
      const prev = state.chokepoints[id]?.status ?? "open";
      state.chokepoints[id] = { id, status, since: state.tick, note: str(ev.params.headline, `${spec.name} ${status}`) };
      const shutting = status !== "open" && prev === "open";
      const reopening = status === "open" && prev !== "open";
      const scale = status === "closed" ? 1 : 0.6;
      if (shutting) {
        state.factors = { ...state.factors, freightIndex: state.factors.freightIndex * (1 + spec.freightShock.value * scale), dubaiEW: state.factors.dubaiEW + spec.ewShock.value * scale };
        state.world = applyWorldShock(state.world, { geo: 0.15 * scale, eventIntensity: 0.5 }, { freightDemand: state.world.targets.freightDemand * (1 + spec.freightShock.value * 0.5 * scale) });
        jumpBrent(state, 0.015 * scale);
      }
      if (reopening) state.world = applyWorldShock(state.world, {}, { freightDemand: 1 });
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, `${spec.name} ${status}`), body: str(ev.params.body, `${spec.name} is now ${status}. ${spec.what}. Freight and the East-West spread reprice; ships bound through it ${status === "closed" ? "are rerouted" : "must wait for a convoy or go round"}.`), eventId: ev.id });
      const events: EngineEvent[] = [{ kind: "chokepoint", tick: state.tick, text: n.headline, pause: true, data: { id, status } }];
      if (status === "closed") events.push(...rerouteAround(state, id));
      return events;
    },
  },
  port_congestion: {
    kind: "port_congestion", title: "Port congestion",
    fire(state, ev) {
      const port = str(ev.params.port, "ROTTERDAM");
      const hours = num(ev.params.hours, 48);
      state.portCongestion[port] = state.tick + hours;
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, `${PORTS[port].name}: berths congested, ${Math.round(hours / 24)}-day queue`), body: str(ev.params.body, `Ships arriving at ${PORTS[port].name} wait about ${hours} hours for a berth. Laytime is 36 hours; a ship that arrives now pays demurrage. A ship that slows down arrives when the queue has cleared.`), eventId: ev.id });
      return [{ kind: "event", tick: state.tick, text: n.headline, pause: true, data: { port, hours } }];
    },
  },
  port_strike: {
    kind: "port_strike", title: "Port strike",
    fire(state, ev) {
      const port = str(ev.params.port, "ROTTERDAM");
      const hours = num(ev.params.hours, 72);
      state.portCongestion[port] = state.tick + hours;
      state.world = applyWorldShock(state.world, { eventIntensity: 0.2 });
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, `Strike shuts ${PORTS[port].name} berths for ${Math.round(hours / 24)} days`), body: str(ev.params.body, "Nothing loads or discharges until it ends; laytime keeps counting."), eventId: ev.id });
      return [{ kind: "event", tick: state.tick, text: n.headline, pause: true }];
    },
  },
  quality_claim: {
    kind: "quality_claim", title: "Quality claim", card: "basis_risk",
    fire(state, ev) {
      const cargo = [...state.cargoes].reverse().find((c) => c.status === "delivered" || c.status === "discharging");
      if (!cargo) { ev.fired = false; ev.tick = state.tick + 24; return []; }
      if (cargo.claims.some((c) => c.kind === "quality")) { ev.fired = true; return []; }
      const usdPerBbl = num(ev.params.usdPerBbl, 0.35);
      const claim = raiseQualityClaim(state, cargo, usdPerBbl, str(ev.params.text, `Sulphur tested ${(cargo.quality.sulphur + 0.06).toFixed(2)}% against a ${cargo.quality.sulphur.toFixed(2)}% specification.`));
      return [{ kind: "claim", tick: state.tick, text: `Quality claim on ${GRADES[cargo.grade].name} ${cargo.id}: ${claim.text} ${claim.amountUsd >= 0 ? "$" + Math.round(claim.amountUsd).toLocaleString() : ""}. Settle or contest it on the Desk.`, pause: true, data: { cargoId: cargo.id, claimId: claim.id } }];
    },
  },
  grade_diff_shock: {
    kind: "grade_diff_shock", title: "Differential moves",
    fire(state, ev) {
      const grade = str(ev.params.grade, "BONNY_LIGHT") as Grade;
      const delta = num(ev.params.delta, -0.8);
      state.factors = { ...state.factors, gradeDiffs: { ...state.factors.gradeDiffs, [grade]: state.factors.gradeDiffs[grade] + delta } };
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, `${GRADES[grade].name} differential ${delta < 0 ? "weakens" : "strengthens"} ${Math.abs(delta).toFixed(2)}`), body: str(ev.params.body, `${GRADES[grade].name} is now ${state.factors.gradeDiffs[grade] >= 0 ? "+" : ""}${state.factors.gradeDiffs[grade].toFixed(2)} over ${GRADES[grade].benchmark}. An unsold cargo of it is worth that much ${delta < 0 ? "less" : "more"} per barrel.`), eventId: ev.id });
      return [{ kind: "event", tick: state.tick, text: n.headline, pause: true }];
    },
  },
  field_outage: {
    kind: "field_outage", title: "Field outage",
    fire(state, ev) {
      const kbd = num(ev.params.kbd, 300);
      state.world = applyWorldShock(state.world, { eventIntensity: 0.3, geo: 0.05 }, { crudeBalance: state.world.targets.crudeBalance - kbd });
      jumpBrent(state, 0.01);
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, `Field outage removes ${kbd} kb/d`), body: str(ev.params.body, "Prompt barrels are scarcer; the front spread and the Dated differential firm."), eventId: ev.id });
      return [{ kind: "event", tick: state.tick, text: n.headline, pause: true }];
    },
  },
  tanker_seizure: {
    kind: "tanker_seizure", title: "Tanker seized",
    fire(state, ev) {
      state.factors = { ...state.factors, freightIndex: state.factors.freightIndex * 1.15, dubaiEW: state.factors.dubaiEW + 0.6 };
      state.world = applyWorldShock(state.world, { geo: 0.25, eventIntensity: 0.6 }, { freightDemand: state.world.targets.freightDemand * 1.08 });
      jumpBrent(state, 0.025);
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, "Tanker seized in the Gulf of Oman; war-risk premiums jump"), body: str(ev.params.body, "Hire and insurance rise for anything transiting Hormuz; the East-West spread widens."), eventId: ev.id });
      return [{ kind: "event", tick: state.tick, text: n.headline, pause: true }];
    },
  },
  freight_shock: {
    kind: "freight_shock", title: "Freight market moves",
    fire(state, ev) {
      const pct = num(ev.params.pct, 0.2);
      state.factors = { ...state.factors, freightIndex: state.factors.freightIndex * (1 + pct) };
      state.world = applyWorldShock(state.world, {}, { freightDemand: state.world.targets.freightDemand * (1 + pct / 2) });
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, `Tanker rates ${pct > 0 ? "jump" : "fall"} ${Math.abs(Math.round(pct * 100))}%`), body: str(ev.params.body, "Voyage charters reprice for anyone who has not fixed yet."), eventId: ev.id });
      return [{ kind: "news", tick: state.tick, text: n.headline, pause: false }];
    },
  },

  rumour: {
    kind: "rumour", title: "A rumour", card: "rumour_base_rate",
    fire(state, ev) {
      const pct = num(ev.params.moveNow, 0.01);
      jumpBrent(state, Math.log(1 + pct));
      state.world = applyWorldShock(state.world, { eventIntensity: 0.2 });
      const n = publishNews(state, { source: "rumour", headline: str(ev.params.headline, "Rumour: a supply disruption"), body: str(ev.params.body, "Unconfirmed. The market moves on it now; confirmation or denial follows."), eventId: ev.id });
      return [{ kind: "rumour", tick: state.tick, text: n.headline, pause: true, data: { truthful: ev.params.truthful } }];
    },
  },
  rumour_resolve: {
    kind: "rumour_resolve", title: "A rumour resolved",
    fire(state, ev) {
      const src = String(ev.params.rumourId);
      const item = state.news.find((n) => n.eventId === src);
      const pct = num(ev.params.moveNow, 0.01);
      jumpBrent(state, -Math.log(1 + pct));
      if (item) resolve(state, item.id, "false", str(ev.params.text, "Denied: the rumour was false; the move unwinds."));
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, "Denied: no disruption"), body: str(ev.params.text, "The rumour was false. The market gives the move back."), eventId: ev.id });
      return [{ kind: "news", tick: state.tick, text: n.headline, pause: true }];
    },
  },
  counterparty_default: {
    kind: "counterparty_default", title: "A counterparty defaults", card: "cheapest_for_a_reason",
    fire(state, ev) {
      const cp = str(ev.params.counterparty, "VANTAGE");
      const victims = state.cargoes.filter((c) => c.purchase.counterparty === cp && (c.status === "contracted" || c.status === "fixed"));
      const events: EngineEvent[] = [];
      for (const c of victims) {
        state.pnl.attribution.push(...cancelCargo(state, c, cp, `${COUNTERPARTIES[cp].name} failed to deliver`, true));
        events.push({ kind: "credit", tick: state.tick, text: `${COUNTERPARTIES[cp].name} has defaulted: ${GRADES[c.grade].name} ${c.id} will not load.${c.sale ? " Your onward sale cannot be delivered and the receiver claims." : ""}${c.insured ? " Your insurance pays 90% of the loss." : ""}`, pause: true, data: { cargoId: c.id } });
        events.push(...sellerDefault(state, c, str(ev.params.body, "Failed to perform on a cargo.")));
      }
      for (const t of state.tenders) if (t.counterparty === cp && t.status === "open") t.status = "expired";
      const cs = state.counterparties[cp];
      if (cs) { cs.defaulted = true; cs.gone = true; }
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, `${COUNTERPARTIES[cp].name} stops performing on contracts`), body: str(ev.params.body, "Banks pulled its lines. Cargoes it sold will not load; cargoes it bought will not be paid."), eventId: ev.id });
      events.push({ kind: "credit", tick: state.tick, text: n.headline, pause: victims.length === 0 });
      if (!victims.length) events.push(...moveRating(state, cp, -40, "default"));
      return events;
    },
  },
  counterparty_vanish: {
    kind: "counterparty_vanish", title: "A counterparty disappears",
    fire(state, ev) {
      const cp = str(ev.params.counterparty, "MERIDIAN_TRADERS");
      const events: EngineEvent[] = [];
      for (const t of state.tenders) if (t.counterparty === cp && t.status === "open") { t.status = "expired"; t.trap = `${COUNTERPARTIES[cp].name} withdrew every quote.`; }
      for (const c of state.cargoes) if (c.purchase.counterparty === cp && (c.status === "contracted" || c.status === "fixed")) {
        state.pnl.attribution.push(...cancelCargo(state, c, cp, `${COUNTERPARTIES[cp].name} disappeared`, false));
        events.push({ kind: "credit", tick: state.tick, text: `${COUNTERPARTIES[cp].name} is gone: ${GRADES[c.grade].name} ${c.id} is cancelled without a claim either way.`, pause: true, data: { cargoId: c.id } });
      }
      const cs = state.counterparties[cp];
      if (cs) cs.gone = true;
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, `${COUNTERPARTIES[cp].name} closes its doors`), body: str(ev.params.body, "Phones unanswered since Friday. Open quotes are withdrawn."), eventId: ev.id });
      events.push({ kind: "credit", tick: state.tick, text: n.headline, pause: true });
      return events;
    },
  },
  rating_change: {
    kind: "rating_change", title: "Rating change",
    fire(state, ev) {
      return moveRating(state, str(ev.params.counterparty, "ADRIATIC_SMALL"), num(ev.params.delta, -15), str(ev.params.body, "An agency moved the rating."));
    },
  },

  // ---------------------------------------------------------------- milestone 4: products, gas, options, signals
  hurricane: {
    kind: "hurricane", title: "Gulf of Mexico hurricane", card: "turnaround_is_supply",
    fire(state, ev) {
      const days = num(ev.params.days, 5);
      const hours = days * 24;
      state.factors = { ...state.factors, gasolineCrack: state.factors.gasolineCrack + num(ev.params.gasoline, 4), dieselCrack: state.factors.dieselCrack + num(ev.params.diesel, 2) };
      jumpBrent(state, -num(ev.params.crudePct, 0.02));
      state.world = applyWorldShock(state.world, { eventIntensity: 0.6, usInvGap: 3 }, { refineryRuns: state.world.targets.refineryRuns - num(ev.params.runs, 0.08) });
      for (const port of ["HOUSTON", "CORPUS_CHRISTI", "SABINE_PASS", "FREEPORT", "ST_JAMES"]) state.portCongestion[port] = Math.max(state.portCongestion[port] ?? 0, state.tick + hours);
      if (state.refinery && ev.params.shutsPlant !== false) state.refinery.shutUntil = state.tick + hours;
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, `Hurricane makes landfall on the Gulf Coast: refineries shut, ports closed for ${days} days`), body: str(ev.params.body, `Gulf Coast refineries are down and the ports are closed. Gasoline and diesel cracks jump; crude backs up and the prompt softens.${state.refinery ? " Your plant is shut: no runs, fixed costs still paid, and any crack hedge you carry is now a naked short crack." : ""}`), eventId: ev.id });
      return [{ kind: "refinery", tick: state.tick, text: n.headline, pause: true, data: { days } }];
    },
  },
  hurricane_end: {
    kind: "hurricane_end", title: "Gulf Coast restarts",
    fire(state, ev) {
      state.world = applyWorldShock(state.world, {}, { refineryRuns: state.world.targets.refineryRuns + num(ev.params.runs, 0.08) });
      const n = publishNews(state, { source: "wire", headline: "Gulf Coast refineries restarting; ports reopen", body: "Runs come back over the week; the crack premium fades." + (state.refinery ? " Your plant restarts at its set run rate." : ""), eventId: ev.id });
      return [{ kind: "refinery", tick: state.tick, text: n.headline, pause: false }];
    },
  },
  plant_maintenance: {
    kind: "plant_maintenance", title: "Turnaround at your plant", card: "turnaround_is_supply",
    fire(state, ev) {
      const days = num(ev.params.days, 7);
      if (state.refinery) state.refinery.maintenanceUntil = state.tick + days * 24;
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, `Your plant: ${days}-day turnaround on the cracker; runs capped at 50%`), body: str(ev.params.body, "Maintenance that was always in the plan. Half the crude runs for the duration: half the margin, the same fixed cost, and a crack hedge sized for full runs is now twice too big."), eventId: ev.id });
      return [{ kind: "refinery", tick: state.tick, text: n.headline, pause: true, data: { days } }];
    },
  },
  vol_spike: {
    kind: "vol_spike", title: "Vol spike", card: "vol_is_a_price",
    fire(state, ev) {
      state.world = applyWorldShock(state.world, { eventIntensity: num(ev.params.intensity, 0.9), geo: num(ev.params.geo, 0.1) });
      jumpBrent(state, num(ev.params.pct, -0.015));
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, "Implied vol jumps: options reprice across the curve"), body: str(ev.params.body, "The surface moves up by a third in an hour and the regime turns stressed: depth halves. Long options earn on vega, short options bleed; every delta hedge is wrong by the gamma until it is reset."), eventId: ev.id });
      return [{ kind: "option", tick: state.tick, text: n.headline, pause: true }];
    },
  },
  cold_snap: {
    kind: "cold_snap", title: "Cold snap in Europe", card: "storage_is_the_gas_curve",
    fire(state, ev) {
      const hdd = num(ev.params.hdd, 6);
      const days = num(ev.params.days, 7);
      state.world = applyWorldShock(state.world, { hddEu: hdd, eventIntensity: 0.3 }, { hddEu: state.world.targets.hddEu + hdd });
      state.factors = { ...state.factors, ttfPrompt: state.factors.ttfPrompt * Math.exp(num(ev.params.pct, 0.08)) };
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, `Cold snap settles over north-west Europe for ${days} days`), body: str(ev.params.body, `Heating demand runs ${hdd} degree-days above normal; storage drains faster and TTF jumps. The Asian premium narrows as European prices catch up with JKM.`), eventId: ev.id });
      return [{ kind: "event", tick: state.tick, text: n.headline, pause: true, data: { hdd, days } }];
    },
  },
  cold_snap_end: {
    kind: "cold_snap_end", title: "Cold snap ends",
    fire(state, ev) {
      state.world = applyWorldShock(state.world, {}, { hddEu: state.world.targets.hddEu - num(ev.params.hdd, 6) });
      const n = publishNews(state, { source: "wire", headline: "Temperatures back to normal", body: "The draw slows; the prompt premium fades.", eventId: ev.id });
      return [{ kind: "news", tick: state.tick, text: n.headline, pause: false }];
    },
  },
  refinery_fire: {
    kind: "refinery_fire", title: "Refinery fire", card: "lags",
    fire(state, ev) {
      const days = num(ev.params.days, 10);
      state.factors = { ...state.factors, dieselCrack: state.factors.dieselCrack + num(ev.params.diesel, 2.5), gasolineCrack: state.factors.gasolineCrack + num(ev.params.gasoline, 1.2), gradeDiffs: { ...state.factors.gradeDiffs, BASRAH_MEDIUM: state.factors.gradeDiffs.BASRAH_MEDIUM - 0.4, ARAB_LIGHT: state.factors.gradeDiffs.ARAB_LIGHT - 0.3 } };
      state.world = applyWorldShock(state.world, { eventIntensity: 0.35 }, { refineryRuns: state.world.targets.refineryRuns - num(ev.params.runs, 0.03) });
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, "Fire at the Jamnagar complex; a crude unit down for weeks"), body: str(ev.params.body, `The world's largest refinery loses a crude unit for about ${days} days. Diesel exports fall and the diesel crack jumps; the sour crude it would have run is cheaper.`), eventId: ev.id });
      return [{ kind: "event", tick: state.tick, text: n.headline, pause: true, data: { days } }];
    },
  },
  refinery_fire_end: {
    kind: "refinery_fire_end", title: "Refinery restarts",
    fire(state, ev) {
      state.world = applyWorldShock(state.world, {}, { refineryRuns: state.world.targets.refineryRuns + num(ev.params.runs, 0.03) });
      const n = publishNews(state, { source: "wire", headline: "Jamnagar crude unit restarts", body: "Diesel exports resume; the crack premium fades.", eventId: ev.id });
      return [{ kind: "news", tick: state.tick, text: n.headline, pause: false }];
    },
  },
  expiry_squeeze: {
    kind: "expiry_squeeze", title: "Squeeze into expiry", card: "squeeze_into_expiry",
    fire(state, ev) {
      const inst = str(ev.params.inst, "WTI") as "WTI" | "BRENT" | "HH";
      const front = state.listed[inst][0];
      // the front settles about `settleAt` (default -30): the squeeze is the gap from where it trades now, ramping in over the last two weeks
      const amount = num(ev.params.settleAt, -30) - (state.quotes[`${inst}:${front}`]?.mid ?? 0);
      state.factors = { ...state.factors, squeeze: { ...(state.factors.squeeze ?? {}), [inst]: amount } };
      state.world = applyWorldShock(state.world, { usInvGap: num(ev.params.usInvGap, 40), eventIntensity: 0.8 });
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, `Cushing at tank tops: the ${monthLabel(front)} ${INSTRUMENTS_NAME[inst]} contract has nowhere to deliver`), body: str(ev.params.body, `Storage at the delivery hub is full and the front contract is a promise to take oil nobody can take. It trades away from the curve into expiry and can settle below zero (stylised: a landlocked expiry squeeze). Anyone long must roll or close before the last days; the next month is unaffected.`), eventId: ev.id });
      return [{ kind: "event", tick: state.tick, text: n.headline, pause: true, data: { inst, amount } }];
    },
  },
  gas_shock: {
    kind: "gas_shock", title: "Gas market shock",
    fire(state, ev) {
      state.factors = { ...state.factors, hhPrompt: state.factors.hhPrompt * Math.exp(num(ev.params.hhPct, 0)), ttfPrompt: state.factors.ttfPrompt * Math.exp(num(ev.params.ttfPct, 0)) };
      state.world = applyWorldShock(state.world, { gasUs: num(ev.params.usGas, 0), gasEu: num(ev.params.euGas, 0), eventIntensity: num(ev.params.intensity, 0.2) }, { usGasGap: state.world.targets.usGasGap + num(ev.params.usGasTarget, 0), euGasGap: state.world.targets.euGasGap + num(ev.params.euGasTarget, 0) });
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, "Gas market moves"), body: str(ev.params.body, "Henry Hub and TTF reprice."), eventId: ev.id });
      return [{ kind: "event", tick: state.tick, text: n.headline, pause: num(ev.params.pause, 1) === 1 }];
    },
  },
  option_programme: {
    kind: "option_programme", title: "A producer's hedging programme", card: "delta_moves",
    fire(state, ev) {
      const cp = str(ev.params.counterparty, "DELTA_INDEPENDENT");
      const inst = str(ev.params.inst, "BRENT") as "BRENT" | "WTI";
      const idx = Math.min(num(ev.params.monthIdx, 2), state.listed[inst].length - 1);
      const month = state.listed[inst][idx];
      const qty = num(ev.params.qty, 300);
      const F = state.quotes[`${inst}:${month}`]?.mid ?? 0;
      const grid = listedStrikes(state, inst, month);
      const want = F + num(ev.params.strikeOffset, -3);
      const strike = grid.reduce((a, k) => (Math.abs(k - want) < Math.abs(a - want) ? k : a), grid[0]);
      // the client buys puts from the desk: the desk sells at its bid, and is short from here
      const events: EngineEvent[] = fillOption(state, makeOptionOrder(state, cp, inst, month, "sell", qty, "put", strike, "outright"));
      const n = publishNews(state, { source: "wire", headline: str(ev.params.headline, `${COUNTERPARTIES[cp].name} executes its quarterly hedging programme with the desk: ${qty} ${inst} ${strike} puts`), body: str(ev.params.body, `The producer bought ${qty} lots of ${monthLabel(month)} ${strike} puts from you at the bid. You are short the puts: short vega, short gamma, long theta, and long ${inst} by the delta. Delta hedge it by selling futures; the risk manager counts the naked lots.`), eventId: ev.id });
      events.push({ kind: "option", tick: state.tick, text: n.headline, pause: true, data: { inst, month, strike, qty } });
      return events;
    },
  },
  gas_storage_release: {
    kind: "gas_storage_release", title: "Weekly US gas storage", card: "expected_vs_actual",
    fire(state, ev, s) {
      const rel = state.releases.find((r) => r.id === ev.id);
      // the true weekly change: the seasonal injection or withdrawal less the heating anomaly, plus survey noise (bcf)
      const seasonal = state.world.targets.usGasGap >= 0 ? 60 : 40;
      const trueChange = seasonal - 6 * state.world.hddAnomaly.us + s.normal() * 12;
      const consensus = rel?.consensus?.v ?? seasonal;
      const actual = Math.round(trueChange);
      const surprise = actual - consensus;
      state.factors = { ...state.factors, hhPrompt: state.factors.hhPrompt * Math.exp(-FACTORS.hhPerBcfGap.value * surprise * 2) };
      state.world = applyWorldShock(state.world, { gasUs: surprise, eventIntensity: 0.1 });
      if (rel) { rel.actual = { v: actual, at: state.tick, why: "Weekly US gas storage change: the seasonal flow less the heating anomaly, plus survey noise." }; rel.published = true; }
      const n = publishNews(state, { source: "release", headline: `Gas storage ${actual >= 0 ? "+" : ""}${actual} bcf versus ${consensus >= 0 ? "+" : ""}${Math.round(consensus)} expected`, body: `An injection of ${actual} bcf against ${Math.round(consensus)} expected: a ${Math.abs(surprise).toFixed(0)} bcf ${surprise > 0 ? "bearish" : "bullish"} surprise for Henry Hub.`, eventId: ev.id });
      return [{ kind: "release", tick: state.tick, text: n.headline, pause: true, data: { actual, consensus, surprise } }];
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
      const truthful = typeof params.leakTruthful === "boolean" ? params.leakTruthful : s.chance(2 / 3);
      const others = ["cut", "hike", "hold"].filter((d) => d !== params.decision);
      const claim = truthful ? String(params.decision) : s.pick(others);
      out.push({ id: `${id}:leak`, kind: "opec_leak", tick: tick - 24, fired: false, params: { claim, kbd: params.kbd ?? 500, truthful } });
    }
    if (e.kind === "rumour") {
      const pTrue = typeof params.pTrue === "number" ? params.pTrue : 0.5;
      const truthful = typeof params.truthful === "boolean" ? params.truthful : s.chance(pTrue);
      params.truthful = truthful;
      const resolveTick = tick + (typeof params.resolveHours === "number" ? params.resolveHours : 48);
      if (truthful) {
        const realKind = str(params.eventKind, "field_outage");
        let realParams: Record<string, number | string | boolean> = {};
        try { realParams = typeof params.eventParams === "string" ? JSON.parse(params.eventParams) : {}; } catch { realParams = {}; }
        out.push({ id: `${id}:truth`, kind: realKind, tick: resolveTick, fired: false, params: { ...realParams, confirms: id } });
      } else out.push({ id: `${id}:false`, kind: "rumour_resolve", tick: resolveTick, fired: false, params: { rumourId: id, moveNow: typeof params.moveNow === "number" ? params.moveNow : 0.01, headline: str(params.denyHeadline, "Denied: the rumour was false"), text: str(params.denyText, "The rumour was false. The market gives the move back.") } });
    }
    if (e.kind === "refinery_turnaround") {
      const days = typeof params.days === "number" ? params.days : 10;
      out.push({ id: `${id}:end`, kind: "turnaround_end", tick: tick + days * 24, fired: false, params: { runs: -(typeof params.runs === "number" ? params.runs : -0.08) } });
    }
    if (e.kind === "hurricane") out.push({ id: `${id}:end`, kind: "hurricane_end", tick: tick + (typeof params.days === "number" ? params.days : 5) * 24, fired: false, params: { runs: typeof params.runs === "number" ? params.runs : 0.08 } });
    if (e.kind === "cold_snap") out.push({ id: `${id}:end`, kind: "cold_snap_end", tick: tick + (typeof params.days === "number" ? params.days : 7) * 24, fired: false, params: { hdd: typeof params.hdd === "number" ? params.hdd : 6 } });
    if (e.kind === "refinery_fire") out.push({ id: `${id}:end`, kind: "refinery_fire_end", tick: tick + (typeof params.days === "number" ? params.days : 10) * 24, fired: false, params: { runs: typeof params.runs === "number" ? params.runs : 0.03 } });
    out.push({ id, kind: e.kind, tick, fired: false, params });
  });
  return out.sort((a, b) => a.tick - b.tick);
}

/** Fire every event due at the current tick. */
const DELAYABLE = new Set(["field_outage", "tanker_seizure", "chokepoint", "port_strike", "port_congestion", "grade_diff_shock", "freight_shock", "balance_shift", "inventory_shock", "geo_scare", "refinery_turnaround", "counterparty_default", "counterparty_vanish", "cold_snap", "refinery_fire", "hurricane"]);

export function fireDue(state: State, s: Stream): EngineEvent[] {
  const events: EngineEvent[] = [];
  for (const ev of state.events) {
    if (ev.fired || ev.tick !== state.tick) continue;
    const def = EVENT_LIBRARY[ev.kind];
    ev.fired = true;
    if (!def) continue;
    const delay = typeof ev.params.delay === "number" ? ev.params.delay : DELAYABLE.has(ev.kind) ? state.infoDelayHours : 0;
    state.pendingNewsDelay = delay;
    const fired = def.fire(state, ev, s);
    state.pendingNewsDelay = 0;
    for (const sig of state.signals) if (sig.eventId === ev.id) sig.headlineTick = state.tick + delay;
    if (typeof ev.params.confirms === "string") {
      const item = state.news.find((n) => n.eventId === ev.params.confirms);
      if (item) resolve(state, item.id, "true", "Confirmed: the rumour was right.");
    }
    // a delayed event's headlines reach the screen later; the world moves now
    events.push(...(delay > 0 ? fired.filter((e) => !["news", "event", "release", "rumour", "credit"].includes(e.kind)) : fired));
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
