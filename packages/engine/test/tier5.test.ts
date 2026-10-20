import { describe, expect, it } from "vitest";
import { makeRng } from "../src/rng";
import { applyActions, newGame, tick } from "../src/engine";
import { attributionTotals } from "../src/pnl";
import { marginRequired } from "../src/finance";
import { bookVar } from "../src/risk";
import { isSettleTick } from "../src/calendar";
import { ckey, estimateFill } from "../src/liquidity";
import { issueTender } from "../src/counterparties";
import { computeScore } from "../src/scoring";
import type { Action, State } from "../src/types";
import { testLevel } from "./helpers";

const P = "p1";
const ALL_UNLOCKS: Action["type"][] = ["order", "spread", "roll", "close", "cancel_order", "draw_line", "repay_line", "post_margin", "convert_fx", "open_card", "ask_mentor", "answer_drill", "answer_quiz", "end_level", "request_limit", "accept_tender", "decline_tender", "fix_charter", "instruct_ship", "efp", "settle_claim", "contest_claim", "open_lc", "insure", "counter_tender", "lease_tank", "store_cargo", "blend", "release_tank", "option_order", "option_strategy", "set_runs", "set_slate", "book_regas", "buy_feed"];
const LOOSE = { var95: 50e6, netLots: { BRENT: 5000, WTI: 5000, RBOB: 5000, ULSD: 5000, HH: 5000, TTF: 5000, DUBAI: 5000, JKM: 5000 }, grossLots: 20000, stopLoss: 100e6, drawdown: 120e6, concentration: 50 };
const tier5 = (id: number, extra: Partial<Parameters<typeof testLevel>[0]> = {}) => testLevel({ id, days: 30, startDate: "2027-04-05", capital: 50e6, creditLine: 400e6, instruments: ["BRENT", "WTI", "DUBAI", "TTF"], unlocks: ALL_UNLOCKS, limits: LOOSE, ...extra });

function run(spec: ReturnType<typeof testLevel>, seed: number, policy: (s: State) => Action[], maxTicks?: number) {
  const rng = makeRng(seed);
  let s = newGame(spec, seed, { par: 0 });
  const checks: { tick: number; gap: number }[] = [];
  for (let t = 0; t < (maxTicks ?? spec.days * 24) && s.level.status === "running"; t++) {
    s = tick(s, policy(s), rng).state;
    if (isSettleTick(s.startDay, s.tick)) checks.push({ tick: s.tick, gap: Object.values(attributionTotals(s.pnl.attribution)).reduce((a, b) => a + b, 0) - s.pnl.total });
  }
  return { s, checks };
}

describe("the inherited book", () => {
  it("opening actions are applied at tick 0, including a cargo on offer from a tick-0 tender, and the state replays identically", () => {
    const spec = tier5(1100, { events: [{ id: "t0", kind: "tender", day: 0, hour: 0, params: { counterparty: "GULF_NATIONAL", side: "offer", grade: "ARAB_LIGHT", bbl: 1000000, incoterm: "FOB", port: "RAS_TANURA", basis: "DUBAI", windowKind: "after_bl", windowDays: 5, laycanStart: 4, laycanDays: 2, openHours: 48 } }], opening: [
      { type: "order", player: "desk", inst: "WTI", month: "2027-05", side: "buy", qty: 100, kind: "market" },
      { type: "accept_tender", player: "desk", tenderId: "T1" },
    ] });
    const s = newGame(spec, 3, { par: 0 });
    expect(s.tick).toBe(0);
    expect(s.lots.find((l) => l.inst === "WTI")!.qty).toBe(100);
    expect(s.cargoes.length).toBe(1);
    expect(s.cargoes[0].grade).toBe("ARAB_LIGHT");
    const again = newGame(spec, 3, { par: 0 });
    expect(JSON.stringify(again)).toBe(JSON.stringify(s));
    expect(() => newGame(tier5(1101, { opening: [{ type: "order", player: "desk", inst: "WTI", month: "2031-01", side: "buy", qty: 1, kind: "market" }] }), 1, { par: 0 })).toThrow(/refused/);
  });
});

describe("the squeeze into expiry", () => {
  it("drags the front month away from the curve, lets it trade and settle below zero, settles a long at the negative price, and leaves the next month alone", () => {
    const spec = tier5(1102, { days: 20, instruments: ["WTI", "BRENT"], events: [{ id: "sq", kind: "expiry_squeeze", day: 3, hour: 10, params: { inst: "WTI", settleAt: -30 } }] });
    const s0 = newGame(spec, 4, { par: 0 });
    const front = s0.listed.WTI[0];
    const expiry = s0.contracts[ckey("WTI", front)].expiryTick;
    expect(expiry).toBeLessThan(20 * 24);
    let bought = false;
    const { s, checks } = run(spec, 4, (st) => (!bought && st.tick === 2 ? ((bought = true), [{ type: "order", player: P, inst: "WTI", month: front, side: "buy", qty: 10, kind: "market" }]) : []));
    for (const c of checks) expect(Math.abs(c.gap), `tick ${c.tick}`).toBeLessThan(0.01);
    const exp = s.fills.find((f) => f.tag === "expiry")!;
    expect(exp).toBeDefined();
    expect(exp.price).toBeLessThan(0);
    expect(s.lots.filter((l) => l.inst === "WTI").length).toBe(0);
    expect(s.pnl.attribution.some((r) => /squeezed into expiry/.test(r.text))).toBe(true);
    expect(s.pnl.total).toBeLessThan(-500000);
    // the next month is on the curve and positive; the squeeze factor is cleared at expiry
    expect(s.quotes[ckey("WTI", s.listed.WTI[0])].mid).toBeGreaterThan(30);
    expect(s.factors.squeeze?.WTI ?? 0).toBe(0);
    expect(s.news.some((n) => /below zero/.test(n.body))).toBe(true);
  });
  it("a negative price still margins on its absolute notional, fills below zero, and VaR says the squeezed contract is left out", () => {
    const spec = tier5(1103, { days: 20, instruments: ["WTI", "BRENT"], events: [{ id: "sq", kind: "expiry_squeeze", day: 1, hour: 10, params: { inst: "WTI", settleAt: -40 } }] });
    const s0 = newGame(spec, 5, { par: 0 });
    const front = s0.listed.WTI[0];
    const expiry = s0.contracts[ckey("WTI", front)].expiryTick;
    const rng = makeRng(5);
    let s = s0;
    while (s.tick < expiry - 30) s = tick(s, [], rng).state;
    const q = s.quotes[ckey("WTI", front)];
    expect(q.mid).toBeLessThan(0);
    expect(q.ask).toBeGreaterThan(q.bid);
    const est = estimateFill(s, "WTI", front, "sell", 5);
    expect(est.price).toBeLessThan(0);
    const r = applyActions(s, [{ type: "order", player: P, inst: "WTI", month: front, side: "sell", qty: 5, kind: "market" }], rng);
    expect(r.refused.length).toBe(0);
    expect(marginRequired(r.state).total).toBeGreaterThan(0);
    expect(bookVar(r.state)!.why).toMatch(/left out/);
  });
});

describe("Partner knobs", () => {
  it("liquidity halves in stress on top of the regime's own cut, and the quote says so", () => {
    const normal = newGame(tier5(1104, { stressDepth: 0.5, regime: "normal" }), 1, { par: 0 });
    const calmBase = normal.quotes[ckey("BRENT", normal.listed.BRENT[0])].depth;
    const stressed = newGame(tier5(1105, { stressDepth: 0.5, regime: "stressed" }), 1, { par: 0 });
    const plain = newGame(tier5(1106, { regime: "stressed" }), 1, { par: 0 });
    const d1 = stressed.quotes[ckey("BRENT", stressed.listed.BRENT[0])].depth;
    const d2 = plain.quotes[ckey("BRENT", plain.listed.BRENT[0])].depth;
    expect(d1).toBeLessThan(d2);
    expect(d1).toBeLessThan(calmBase);
    expect(stressed.quotes[ckey("BRENT", stressed.listed.BRENT[0])].why).toMatch(/dries in stress/);
  });
  it("an adversarial counterparty bids less for a grade you are long of and offers dearer to a book that is long the benchmark", () => {
    const spec = tier5(1107, { adversarial: true, events: [{ id: "t0", kind: "tender", day: 0, hour: 0, params: { counterparty: "NORTHSEA_MAJOR", side: "offer", grade: "FORTIES", bbl: 600000, incoterm: "FOB", port: "SULLOM_VOE", basis: "DATED", windowKind: "after_bl", windowDays: 5, laycanStart: 4, laycanDays: 2, openHours: 48 } }], opening: [{ type: "accept_tender", player: "desk", tenderId: "T1" }, { type: "order", player: "desk", inst: "BRENT", month: "2027-07", side: "buy", qty: 100, kind: "market" }] });
    const s = newGame(spec, 6, { par: 0 });
    const plain = newGame(tier5(1108, { adversarial: false, events: spec.events, opening: spec.opening }), 6, { par: 0 });
    const bid = (st: State) => issueTender(st, { counterparty: "RHINE_REFINING", side: "bid", grade: "FORTIES", bbl: 600000, incoterm: "CIF", port: "ROTTERDAM", window: { kind: "after_discharge", days: 5 }, laycanStart: 12, laycanDays: 3 }, makeRng(6).stream("x", 1));
    const offer = (st: State) => issueTender(st, { counterparty: "NORTHSEA_MAJOR", side: "offer", grade: "FORTIES", bbl: 600000, incoterm: "FOB", port: "SULLOM_VOE", window: { kind: "after_bl", days: 5 }, laycanStart: 12, laycanDays: 3 }, makeRng(6).stream("x", 2));
    expect(bid(s).diff).toBeCloseTo(bid(plain).diff - 0.2, 2);
    expect(offer(s).diff).toBeCloseTo(offer(plain).diff + 0.15, 2);
    expect(bid(s).trap).toMatch(/priced it against you/);
  });
  it("achievements name the behaviours worth rewarding", () => {
    const spec = tier5(1109, { days: 20, instruments: ["WTI", "BRENT"], events: [{ id: "sq", kind: "expiry_squeeze", day: 2, hour: 10, params: { inst: "WTI", settleAt: -30 } }] });
    const { s } = run(spec, 7, () => []);
    const sc = computeScore(s, spec);
    expect(sc.achievements).toContain("Rolled before the squeeze");
  });
});

describe("a closed strait", () => {
  it("holds a ship that sails into it after the closure with no way round, and releases it when the strait reopens", () => {
    const spec = tier5(1110, { days: 40, instruments: ["BRENT", "DUBAI"], events: [
      { id: "t0", kind: "tender", day: 0, hour: 0, params: { counterparty: "GULF_NATIONAL", side: "offer", grade: "ARAB_LIGHT", bbl: 2000000, incoterm: "FOB", port: "RAS_TANURA", basis: "DUBAI", windowKind: "after_bl", windowDays: 5, laycanStart: 2, laycanDays: 1, openHours: 48 } },
      { id: "shut", kind: "chokepoint", day: 1, hour: 9, params: { id: "HORMUZ", status: "closed" } },
      { id: "open", kind: "chokepoint", day: 12, hour: 9, params: { id: "HORMUZ", status: "open" } },
    ], opening: [{ type: "accept_tender", player: "desk", tenderId: "T1" }, { type: "fix_charter", player: "desk", cargoId: "C1", vesselId: "V08" }] });
    const { s } = run(spec, 8, () => []);
    const v = s.voyages[0];
    const held = s.news.length >= 0 && s.pnl.attribution.length >= 0; void held;
    expect(v.legs[1].depTick).not.toBeNull();
    expect(v.legs[1].depTick!).toBeLessThan(12 * 24);
    // the ship was held and sailed on after day 12: its ETA is later than a clean voyage's and it is past Hormuz now
    expect(v.status === "laden" || v.status === "waiting_berth" || v.status === "discharging" || v.status === "done").toBe(true);
    // a clean Ras Tanura to Ningbo voyage is about 20 laden days; the hold adds days
    expect(v.eta).toBeGreaterThan(v.legs[1].depTick! + 24 * 24);
    expect(v.cleared).toContain("HORMUZ");
  });
});

describe("settlement and discipline", () => {
  it("an expiry cash-settles a position bigger than the block rule, and two fatal limits at one close cost one life", () => {
    const spec = tier5(1111, { days: 40, instruments: ["BRENT", "DUBAI"], limits: { ...LOOSE, stopLoss: 1, drawdown: 1 } });
    const s0 = newGame(spec, 9, { par: 0 });
    const front = s0.listed.DUBAI[0];
    const rng = makeRng(9);
    let s = applyActions(s0, [{ type: "order", player: P, inst: "DUBAI", month: front, side: "sell", qty: 700, kind: "market" }], rng).state;
    expect(s.lots.length).toBe(1);
    const expiry = s.contracts[ckey("DUBAI", front)].expiryTick;
    let livesAtFirst = -1;
    while (s.tick < expiry + 30 && s.level.status === "running") { s = tick(s, [], rng).state; if (livesAtFirst < 0 && s.risk.livesLost > 0) livesAtFirst = s.risk.livesLost; }
    expect(s.lots.filter((l) => l.month === front).length).toBe(0);
    expect(livesAtFirst).toBe(1);
  });
});
