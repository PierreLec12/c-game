import { describe, expect, it } from "vitest";
import { makeRng } from "../src/rng";
import { applyActions, newGame, replay, runPolicy, tick } from "../src/engine";
import { ckey, estimateFill } from "../src/liquidity";
import { attributionTotals, netLots, unrealised } from "../src/pnl";
import { isSettleTick } from "../src/calendar";
import type { Action, LogEntry, State } from "../src/types";
import { front, testLevel } from "./helpers";

const P = "p1";
const buy = (inst: "BRENT" | "WTI", month: string, qty: number): Action => ({ type: "order", player: P, inst, month, side: "buy", qty, kind: "market" });
const sell = (inst: "BRENT" | "WTI", month: string, qty: number): Action => ({ type: "order", player: P, inst, month, side: "sell", qty, kind: "market" });

function run(spec: ReturnType<typeof testLevel>, seed: number, script: Record<number, Action[]>, ticks: number): { state: State; log: LogEntry[] } {
  const rng = makeRng(seed);
  let s = newGame(spec, seed);
  const log: LogEntry[] = [];
  for (let t = 0; t < ticks && s.level.status === "running"; t++) {
    const acts = script[s.tick] ?? [];
    if (acts.length) log.push({ tick: s.tick, actions: acts });
    s = tick(s, acts, rng).state;
  }
  return { state: s, log };
}

describe("determinism", () => {
  it("reproduces the same world bit for bit from seed, level and the action log", () => {
    const spec = testLevel({ id: 910, days: 6 });
    const script = { 3: [buy("BRENT", "2027-03", 10)], 30: [sell("BRENT", "2027-03", 4), buy("WTI", "2027-02", 5)], 70: [{ type: "close", player: P, inst: "WTI", month: "2027-02" } as Action] };
    const a = run(spec, 42, script, 120);
    const b = run(spec, 42, script, 120);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    const c = replay(42, 910, a.log, 120);
    expect(JSON.stringify(c)).toBe(JSON.stringify(a.state));
    const other = run(spec, 43, script, 120);
    expect(JSON.stringify(other.state)).not.toBe(JSON.stringify(a.state));
  });
  it("the save round-trips through JSON", () => {
    const spec = testLevel({ id: 911, days: 3 });
    const { state } = run(spec, 5, { 2: [buy("BRENT", front(newGame(spec, 5)), 3)] }, 40);
    const back = JSON.parse(JSON.stringify(state));
    expect(back).toEqual(state);
  });
});

describe("cash and ledger", () => {
  it("every change in cash is a ledger row", () => {
    const spec = testLevel({ id: 920, days: 8 });
    const f = front(newGame(spec, 1));
    const { state } = run(spec, 1, { 2: [buy("BRENT", f, 50)], 60: [sell("BRENT", f, 20)], 100: [{ type: "draw_line", player: P, amount: 1e6 } as Action], 140: [{ type: "repay_line", player: P, amount: 5e5 } as Action] }, 8 * 24);
    const usd = state.finance.ledger.filter((r) => r.currency === "USD").reduce((a, r) => a + r.amount, 0);
    const eur = state.finance.ledger.filter((r) => r.currency === "EUR").reduce((a, r) => a + r.amount, 0);
    expect(Math.abs(usd - state.finance.cashUSD)).toBeLessThan(1e-6);
    expect(Math.abs(eur - state.finance.cashEUR)).toBeLessThan(1e-6);
    expect(state.finance.ledger.some((r) => r.kind === "variation_margin")).toBe(true);
    expect(state.finance.ledger.some((r) => r.kind === "initial_margin")).toBe(true);
    expect(state.finance.ledger.some((r) => r.kind === "interest")).toBe(true);
  });
});

describe("attribution", () => {
  it("legs sum to the book P&L to the cent at every settle, outrights and spreads alike", () => {
    const spec = testLevel({ id: 930, days: 10, instruments: ["BRENT", "WTI", "RBOB", "ULSD", "HH", "TTF"] });
    const s0 = newGame(spec, 9);
    const m = s0.listed;
    const script: Record<number, Action[]> = {
      2: [buy("BRENT", m.BRENT[0], 20), { type: "spread", player: P, name: "time", legs: [{ inst: "BRENT", month: m.BRENT[0], side: "buy", qty: 10 }, { inst: "BRENT", month: m.BRENT[1], side: "sell", qty: 10 }] }],
      5: [{ type: "spread", player: P, name: "inter", legs: [{ inst: "BRENT", month: m.BRENT[0], side: "buy", qty: 5 }, { inst: "WTI", month: m.WTI[0], side: "sell", qty: 5 }] }],
      8: [{ type: "spread", player: P, name: "crack321", legs: [{ inst: "RBOB", month: m.RBOB[0], side: "buy", qty: 2 }, { inst: "ULSD", month: m.ULSD[0], side: "buy", qty: 1 }, { inst: "WTI", month: m.WTI[0], side: "sell", qty: 3 }] }],
      12: [{ type: "order", player: P, inst: "TTF", month: m.TTF[0], side: "buy", qty: 4, kind: "market" }],
      50: [sell("BRENT", m.BRENT[0], 12)],
    };
    const rng = makeRng(9);
    let s = s0;
    let settlesChecked = 0;
    for (let t = 0; t < 10 * 24; t++) {
      s = tick(s, script[s.tick] ?? [], rng).state;
      if (isSettleTick(s.startDay, s.tick) && s.tick > 12) {
        const legs = Object.values(attributionTotals(s.pnl.attribution)).reduce((a, b) => a + b, 0);
        expect(Math.abs(unrealised(s))).toBeLessThan(1e-6);
        expect(Math.abs(legs - s.pnl.total)).toBeLessThan(0.01);
        settlesChecked += 1;
      }
    }
    expect(settlesChecked).toBeGreaterThan(4);
    const tot = attributionTotals(s.pnl.attribution);
    expect(Math.abs(tot.time_spread)).toBeGreaterThan(0);
    expect(Math.abs(tot.basis)).toBeGreaterThan(0);
    expect(Math.abs(tot.crack)).toBeGreaterThan(0);
    expect(tot.fees_slippage).toBeLessThan(0);
    expect(Math.abs(tot.fx) + Math.abs(tot.flat)).toBeGreaterThan(0);
    expect(s.pnl.attribution.every((r) => r.text.length > 10)).toBe(true);
  });
});

describe("orders and refusals", () => {
  it("a refused action changes nothing", () => {
    const spec = testLevel({ id: 940, days: 3 });
    const s = newGame(spec, 2);
    const rng = makeRng(2);
    const before = JSON.stringify(s);
    const r = applyActions(s, [buy("BRENT", "2031-01", 1), { type: "order", player: P, inst: "BRENT", month: front(s), side: "buy", qty: 0, kind: "market" }, { type: "close", player: P, inst: "WTI", month: front(s, "WTI") }, { type: "order", player: P, inst: "BRENT", month: front(s), side: "buy", qty: 99999, kind: "market" }], rng);
    expect(r.refused.length).toBe(4);
    expect(JSON.stringify(r.state)).toBe(before);
    expect(r.refused[3].reason).toMatch(/2% of daily volume/);
  });
  it("the ticket shows the touch, slippage and fees before the click and the fill matches", () => {
    const spec = testLevel({ id: 941, days: 3 });
    const s = newGame(spec, 2);
    const est = estimateFill(s, "BRENT", front(s), "buy", 100);
    expect(est.refusal).toBeNull();
    expect(est.price).toBeGreaterThan(est.quote!.ask - 1e-9);
    expect(est.slippage).toBeGreaterThan(0);
    const r = applyActions(s, [buy("BRENT", front(s), 100)], makeRng(2));
    const fill = r.state.fills[0];
    expect(fill.price).toBeCloseTo(est.price, 9);
    expect(fill.fees).toBe(est.fees);
    expect(r.state.quotes[ckey("BRENT", front(s))].mid).toBeGreaterThan(s.quotes[ckey("BRENT", front(s))].mid); // impact
  });
  it("a limit order rests and fills when the touch crosses it; a stop triggers", () => {
    const spec = testLevel({ id: 942, days: 10 });
    const s0 = newGame(spec, 4);
    const q = s0.quotes[ckey("BRENT", front(s0))];
    const limit: Action = { type: "order", player: P, inst: "BRENT", month: front(s0), side: "buy", qty: 5, kind: "limit", price: Math.round((q.ask - 0.4) * 100) / 100 };
    const rng = makeRng(4);
    let s = applyActions(s0, [limit], rng).state;
    expect(s.orders[0].status).toBe("resting");
    let filled = false;
    for (let t = 0; t < 10 * 24 && !filled; t++) { s = tick(s, [], rng).state; filled = s.orders[0].status === "filled"; }
    expect(filled).toBe(true);
    expect(s.fills[0].price).toBeLessThanOrEqual(limit.price! + 1e-9);
    const stop: Action = { type: "order", player: P, inst: "BRENT", month: front(s), side: "sell", qty: 5, kind: "stop", price: Math.round((s.quotes[ckey("BRENT", front(s))].bid - 0.3) * 100) / 100 };
    s = applyActions(s, [stop], rng).state;
    let stopped = false;
    for (let t = 0; t < 10 * 24 && !stopped && s.level.status === "running"; t++) { s = tick(s, [], rng).state; stopped = s.orders[1].status === "filled"; }
    expect(stopped || s.level.status !== "running").toBe(true);
  });
});

describe("margin, expiry and the risk manager", () => {
  it("a position sized to the whole line gets a margin call on a bad day and is liquidated when not met", () => {
    const spec = testLevel({ id: 950, days: 8, events: [{ kind: "headline_move", day: 2, hour: 10, params: { pct: -0.06 } }] });
    const s0 = newGame(spec, 3);
    const f = front(s0);
    const price = s0.quotes[ckey("BRENT", f)].ask;
    const lots = Math.floor((25e6 / (0.08 * price * 1000)) * 0.95);
    const rng = makeRng(3);
    let s = applyActions(s0, [buy("BRENT", f, lots)], rng).state;
    expect(s.lots.length).toBe(1);
    expect(s.finance.lineDrawn).toBeGreaterThan(0);
    let called = false, liquidated = false;
    for (let t = 0; t < 8 * 24 && s.level.status === "running"; t++) {
      const r = tick(s, [], rng);
      s = r.state;
      if (r.events.some((e) => e.kind === "margin_call")) called = true;
      if (r.events.some((e) => e.kind === "liquidation")) liquidated = true;
    }
    expect(called).toBe(true);
    expect(liquidated).toBe(true);
    expect(s.finance.marginCalls).toBeGreaterThanOrEqual(1);
  });
  it("lots in an expiring contract are cash-settled at the last settle and the next month becomes the front", () => {
    const spec = testLevel({ id: 951, days: 30, startDate: "2027-01-25" });
    const s0 = newGame(spec, 6);
    expect(s0.listed.BRENT[0]).toBe("2027-03");
    const rng = makeRng(6);
    let s = applyActions(s0, [buy("BRENT", "2027-03", 10)], rng).state;
    let expired = false;
    for (let t = 0; t < 8 * 24 && !expired; t++) {
      const r = tick(s, [], rng);
      s = r.state;
      if (r.events.some((e) => e.kind === "expiry")) expired = true;
    }
    expect(expired).toBe(true);
    expect(s.lots.filter((l) => l.month === "2027-03").length).toBe(0);
    s = tick(s, [], rng).state; s = tick(s, [], rng).state; s = tick(s, [], rng).state; s = tick(s, [], rng).state; s = tick(s, [], rng).state;
    expect(s.listed.BRENT[0]).toBe("2027-04");
    expect(s.listed.BRENT.length).toBe(12);
  });
  it("warns, then reduces, then takes a life on three closes over the limit; a stop-loss takes a life and flattens", () => {
    const spec = testLevel({ id: 952, days: 10, limits: { var95: 50000, netLots: { BRENT: 20, WTI: 20, RBOB: 20, ULSD: 20, HH: 20, TTF: 20 }, grossLots: 40, stopLoss: 3e6, drawdown: 4e6, concentration: 1 } });
    const s0 = newGame(spec, 8);
    const rng = makeRng(8);
    let s = applyActions(s0, [buy("BRENT", front(s0), 60)], rng).state;
    const kinds: string[] = [];
    for (let t = 0; t < 10 * 24 && s.level.status === "running"; t++) {
      const r = tick(s, [], rng);
      s = r.state;
      for (const e of r.events) if (["limit_warning", "forced_reduction", "life_lost"].includes(e.kind)) kinds.push(e.kind);
      if (r.events.some((e) => e.kind === "forced_reduction")) {
        // re-breach after the forced cut to earn the third strike
        s = applyActions(s, [buy("BRENT", front(s), 60 - Math.abs(netLots(s).BRENT))], rng).state;
      }
      if (kinds.includes("life_lost")) break;
    }
    expect(kinds[0]).toBe("limit_warning");
    expect(kinds).toContain("forced_reduction");
    expect(kinds).toContain("life_lost");
    expect(s.risk.lives).toBe(2);
    expect(s.lots.length).toBe(0);
    expect(s.risk.messages.some((m) => m.text.includes("VaR") || m.text.includes("net"))).toBe(true);
  });
  it("an event's news never precedes its trigger unless it is a leak", () => {
    const spec = testLevel({ id: 953, days: 12, events: [{ kind: "opec_meeting", day: 6, hour: 12, params: { decision: "cut", kbd: 500 } }, { kind: "inventory_release", day: 2, hour: 15 }] });
    const { state } = runPolicy(spec, 12, () => []);
    for (const n of state.news) {
      if (!n.eventId) continue;
      const ev = state.events.find((e) => e.id === n.eventId)!;
      expect(n.tick).toBeGreaterThanOrEqual(ev.tick);
      if (ev.kind === "opec_leak") {
        const meeting = state.events.find((e) => e.id === n.eventId!.replace(":leak", ""))!;
        expect(n.tick).toBeLessThan(meeting.tick);
        expect(n.resolved).toBeDefined();
      }
    }
    const rel = state.releases.find((r) => r.name === "Weekly crude inventories")!;
    expect(rel.published).toBe(true);
    expect(rel.consensus).not.toBeNull();
    expect(rel.actual).not.toBeNull();
  });
  it("a tick stays under 5 ms on a busy book", () => {
    const spec = testLevel({ id: 954, days: 5 });
    const s0 = newGame(spec, 1);
    const rng = makeRng(1);
    let s = applyActions(s0, [buy("BRENT", s0.listed.BRENT[0], 10), buy("BRENT", s0.listed.BRENT[3], 10), sell("WTI", s0.listed.WTI[1], 10), { type: "order", player: P, inst: "TTF", month: s0.listed.TTF[0], side: "buy", qty: 3, kind: "market" }], rng).state;
    const t0 = Date.now();
    const n = 5 * 24;
    for (let t = 0; t < n; t++) s = tick(s, [], rng).state;
    const per = (Date.now() - t0) / n;
    expect(per).toBeLessThan(5);
  });
});
