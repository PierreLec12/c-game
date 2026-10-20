import { describe, expect, it } from "vitest";
import { makeRng } from "../src/rng";
import { applyActions, newGame, tick } from "../src/engine";
import { attributionTotals, unrealised } from "../src/pnl";
import { cargoesMarkUsd, physicalExposureBbl, basisParts, legMark } from "../src/physical";
import { tanksMarkUsd } from "../src/storage";
import { marginRequired, lotValueUsd } from "../src/finance";
import { breaches, bookVar, stressTable, coverLotsByInst } from "../src/risk";
import { charterQuotes } from "../src/shipping";
import { isSettleTick, HOURS_PER_DAY } from "../src/calendar";
import { black76 } from "../src/options";
import { estimateOptionFill, listedStrikes, nakedShortOptions, optionExpiryTick, optionInputs, optionPositions, optionQuote, strategyLegs } from "../src/optionbook";
import { crackHedgeTargetUnits, crackUnitsHeld, effectiveRuns, refineryMarginPerBbl } from "../src/refinery";
import { signalShape, signalTrades } from "../src/signals";
import { ckey } from "../src/liquidity";
import { priceParts, ttfUsdMmbtu } from "../src/markets";
import { CONVERSIONS, INSTRUMENTS, LNG, OPTIONS, REFINERY, SIGNALS } from "../src/refdata";
import { eurMwhToUsdMmbtu, usdMmbtuToEurMwh } from "../src/conversions";
import type { Action, State } from "../src/types";
import { testLevel } from "./helpers";

const P = "p1";
const ALL_UNLOCKS: Action["type"][] = ["order", "spread", "roll", "close", "cancel_order", "draw_line", "repay_line", "post_margin", "convert_fx", "open_card", "ask_mentor", "answer_drill", "answer_quiz", "end_level", "request_limit", "accept_tender", "decline_tender", "fix_charter", "instruct_ship", "efp", "settle_claim", "contest_claim", "open_lc", "insure", "counter_tender", "lease_tank", "store_cargo", "blend", "release_tank", "option_order", "option_strategy", "set_runs", "set_slate", "book_regas", "buy_feed"];
const LOOSE = { var95: 50e6, netLots: { BRENT: 5000, WTI: 5000, RBOB: 5000, ULSD: 5000, HH: 5000, TTF: 5000, DUBAI: 5000, JKM: 5000 }, grossLots: 20000, stopLoss: 100e6, drawdown: 120e6, concentration: 50 };
const tier4 = (id: number, extra: Partial<Parameters<typeof testLevel>[0]> = {}) => testLevel({ id, days: 40, startDate: "2027-03-01", capital: 50e6, creditLine: 400e6, instruments: ["BRENT", "WTI", "DUBAI", "RBOB", "ULSD", "HH", "TTF", "JKM"], unlocks: ALL_UNLOCKS, limits: LOOSE, ...extra });

function run(spec: ReturnType<typeof testLevel>, seed: number, policy: (s: State) => Action[], maxTicks?: number) {
  const rng = makeRng(seed);
  let s = newGame(spec, seed, { par: 0 });
  const checks: { tick: number; gap: number }[] = [];
  const refused: string[] = [];
  for (let t = 0; t < (maxTicks ?? spec.days * 24) && s.level.status === "running"; t++) {
    const r = tick(s, policy(s), rng);
    s = r.state;
    refused.push(...r.refused.map((x) => `${x.action.type}: ${x.reason}`));
    if (isSettleTick(s.startDay, s.tick)) {
      const legs = Object.values(attributionTotals(s.pnl.attribution)).reduce((a, b) => a + b, 0);
      checks.push({ tick: s.tick, gap: legs - s.pnl.total });
    }
  }
  return { s, checks, refused };
}
const bookGap = (s: State) => Object.values(attributionTotals(s.pnl.attribution)).reduce((a, b) => a + b, 0) - s.pnl.total;

describe("options on the book", () => {
  it("quotes a listed grid at Black-76 one vol point wide, and a fill matches the ticket", () => {
    const spec = tier4(990);
    const s = newGame(spec, 3, { par: 0 });
    const m = s.listed.BRENT[1];
    const strikes = listedStrikes(s, "BRENT", m);
    expect(strikes.length).toBe(2 * OPTIONS.strikesEachSide.value + 1);
    expect(strikes[0]).toBeGreaterThan(0);
    const k = strikes[OPTIONS.strikesEachSide.value];
    const q = optionQuote(s, "BRENT", m, "put", k)!;
    const inp = optionInputs(s, "BRENT", m, k);
    expect(q.mid).toBeCloseTo(black76("put", inp.F, k, inp.T, inp.sigma)!.price, 2);
    expect(q.ask).toBeGreaterThan(q.bid);
    expect(q.greeks!.delta).toBeLessThan(0);
    expect(q.greeks!.delta).toBeGreaterThan(-1);
    const est = estimateOptionFill(s, "BRENT", m, "put", k, "buy", 10);
    expect(est.refusal).toBeNull();
    const r = applyActions(s, [{ type: "option_order", player: P, inst: "BRENT", month: m, strike: k, kind: "put", side: "buy", qty: 10 }], makeRng(3));
    expect(r.refused.length).toBe(0);
    const f = r.state.fills[0];
    expect(f.option?.kind).toBe("put");
    expect(f.price).toBeCloseTo(est.price, 9);
    const lot = r.state.lots[0];
    expect(lot.option?.strike).toBe(k);
    expect(lot.option?.expiryTick).toBe(optionExpiryTick(s, "BRENT", m));
    expect(lot.option!.expiryTick).toBeLessThan(s.contracts[ckey("BRENT", m)].expiryTick);
    // no premium changed hands: futures-style
    expect(r.state.finance.ledger.filter((x) => x.kind === "fee").length).toBe(1);
    expect(marginRequired(r.state).total).toBeGreaterThan(0);
    // a strike off the grid is refused; so is a block
    expect(applyActions(s, [{ type: "option_order", player: P, inst: "BRENT", month: m, strike: k + 0.37, kind: "put", side: "buy", qty: 1 }], makeRng(3)).refused[0].reason).toMatch(/not a listed strike/);
    expect(applyActions(s, [{ type: "option_order", player: P, inst: "BRENT", month: m, strike: k, kind: "put", side: "buy", qty: 5000 }], makeRng(3)).refused[0].reason).toMatch(/block/);
  });
  it("attributes every settle by Greek, the legs sum to the book to the cent, and vega earns when vol spikes", () => {
    const spec = tier4(991, { days: 20, events: [{ id: "v", kind: "vol_spike", day: 8, hour: 11, params: { intensity: 1.0 } }] });
    const s0 = newGame(spec, 5, { par: 0 });
    const m = s0.listed.BRENT[2];
    const k = listedStrikes(s0, "BRENT", m)[OPTIONS.strikesEachSide.value];
    let bought = false;
    const { s, checks } = run(spec, 5, (st) => {
      if (!bought && st.tick === 10) { bought = true; return [{ type: "option_order", player: P, inst: "BRENT", month: m, strike: k, kind: "call", side: "buy", qty: 50 }, { type: "order", player: P, inst: "BRENT", month: m, side: "sell", qty: 25, kind: "market", tag: "hedge" }]; }
      return [];
    });
    for (const c of checks) expect(Math.abs(c.gap), `tick ${c.tick}`).toBeLessThan(0.01);
    const greeks = new Set(s.pnl.attribution.filter((r) => r.leg === "options").map((r) => r.greek));
    expect(greeks.has("delta")).toBe(true);
    expect(greeks.has("theta")).toBe(true);
    expect(greeks.has("vega")).toBe(true);
    // the long call paid theta every settle
    const theta = s.pnl.attribution.filter((r) => r.greek === "theta").reduce((a, r) => a + r.amount, 0);
    expect(theta).toBeLessThan(0);
    // the day vol spiked, the long call earned vega
    const spikeTick = 8 * 24 + 19;
    const vegaOnSpike = s.pnl.attribution.filter((r) => r.greek === "vega" && r.tick === spikeTick).reduce((a, r) => a + r.amount, 0);
    expect(vegaOnSpike).toBeGreaterThan(0);
    expect(s.pnl.attribution.filter((r) => r.leg === "options").every((r) => r.text.length > 20)).toBe(true);
    // VaR counts the option as delta lots; the stress table re-prices under a vol shock
    expect(bookVar(s)!.why).toMatch(/delta-equivalent/);
    const st = stressTable(s);
    expect(st.find((r) => r.priceShock === 0 && r.volShock === 0.05)!.pnlChange).toBeGreaterThan(0);
    expect(optionPositions(s).length).toBe(1);
  });
  it("cash-settles an option at intrinsic value on its own expiry, before the future's", () => {
    const spec = tier4(992, { days: 60, startDate: "2027-03-01" });
    const s0 = newGame(spec, 7, { par: 0 });
    const m = s0.listed.BRENT[0];
    const exp = optionExpiryTick(s0, "BRENT", m);
    expect(exp).toBeGreaterThan(0);
    expect(exp).toBeLessThan(60 * 24);
    const k = listedStrikes(s0, "BRENT", m)[OPTIONS.strikesEachSide.value - 3]; // in the money call
    let done = false;
    const { s } = run(spec, 7, (st) => { if (!done && st.tick === 9) { done = true; return [{ type: "option_order", player: P, inst: "BRENT", month: m, strike: k, kind: "call", side: "buy", qty: 5 }]; } return []; }, exp + 2);
    expect(s.lots.some((l) => l.option)).toBe(false);
    expect(s.fills.length).toBe(1);
    const expiryRow = s.pnl.attribution.find((r) => r.tick === exp && r.leg === "options");
    expect(expiryRow).toBeDefined();
    expect(Math.abs(bookGap(s))).toBeLessThan(0.01);
  });
  it("counts naked short options against the limit and the risk manager breaches on them; a collar on a long cargo is covered", () => {
    const spec = tier4(993, { limits: { ...LOOSE, nakedShortOptions: 20 } });
    const s = newGame(spec, 4, { par: 0 });
    const m = s.listed.BRENT[1];
    const ks = listedStrikes(s, "BRENT", m);
    const r = applyActions(s, [{ type: "option_order", player: P, inst: "BRENT", month: m, strike: ks[12], kind: "call", side: "sell", qty: 50 }], makeRng(4));
    expect(r.refused.length).toBe(0);
    const naked = nakedShortOptions(r.state, coverLotsByInst(r.state));
    expect(naked.total).toBe(50);
    expect(breaches(r.state, 0).some((b) => b.limit === "nakedShortOptions")).toBe(true);
    // long futures cover the short calls
    const r2 = applyActions(r.state, [{ type: "order", player: P, inst: "BRENT", month: m, side: "buy", qty: 40, kind: "market" }], makeRng(4));
    expect(nakedShortOptions(r2.state, coverLotsByInst(r2.state)).total).toBe(10);
    expect(breaches(r2.state, 0).some((b) => b.limit === "nakedShortOptions")).toBe(false);
    // a strategy: a collar is a long put and a short call
    const legs = strategyLegs("collar", [ks[6], ks[10]], "buy");
    expect(legs).toEqual([{ kind: "put", strike: ks[6], side: "buy" }, { kind: "call", strike: ks[10], side: "sell" }]);
    const r3 = applyActions(s, [{ type: "option_strategy", player: P, name: "collar", inst: "BRENT", month: m, strikes: [ks[6], ks[10]], qty: 10, side: "buy" }], makeRng(4));
    expect(r3.refused.length).toBe(0);
    expect(r3.state.lots.length).toBe(2);
    expect(r3.state.lots.every((l) => l.packageId === r3.state.lots[0].packageId)).toBe(true);
  });
});

describe("a producer's programme and a held strike", () => {
  it("books the client's puts as a short position at the desk's bid, and a held strike stays listed when the forward moves away", () => {
    const spec = tier4(1005, { days: 6, events: [{ id: "prog", kind: "option_programme", day: 1, hour: 10, params: { counterparty: "DELTA_INDEPENDENT", inst: "BRENT", monthIdx: 2, qty: 120, strikeOffset: -3 } }] });
    const { s, checks } = run(spec, 21, () => []);
    for (const c of checks) expect(Math.abs(c.gap)).toBeLessThan(0.01);
    const lot = s.lots.find((l) => l.option)!;
    expect(lot.qty).toBe(-120);
    expect(lot.option!.kind).toBe("put");
    expect(s.fills[0].side).toBe("sell");
    expect(s.news.some((n) => /hedging programme/.test(n.headline))).toBe(true);
    // the strike stays listed whatever the forward does
    const far = { ...s, quotes: { ...s.quotes, [ckey("BRENT", lot.month)]: { ...s.quotes[ckey("BRENT", lot.month)], mid: lot.option!.strike + 40 } } } as State;
    expect(listedStrikes(far, "BRENT", lot.month)).toContain(lot.option!.strike);
    expect(nakedShortOptions(s, coverLotsByInst(s)).total).toBe(120);
  });
  it("a gas shock moves the hubs and the storage picture by its parameters", () => {
    const spec = tier4(1006, { days: 4, events: [{ id: "g", kind: "gas_shock", day: 1, hour: 9, params: { hhPct: -0.1, ttfPct: 0.05, euGas: 5, headline: "Test shock" } }] });
    const s0 = newGame(spec, 2, { par: 0 });
    const rng = makeRng(2);
    let s = s0;
    for (let i = 0; i < 24 + 8; i++) s = tick(s, [], rng).state;
    const before = s.factors.hhPrompt, ttfBefore = s.factors.ttfPrompt, eu = s.world.gasStorageGap.eu;
    s = tick(s, [], rng).state; s = tick(s, [], rng).state;
    expect(s.factors.hhPrompt / before).toBeLessThan(0.95);
    expect(s.factors.ttfPrompt / ttfBefore).toBeGreaterThan(1.02);
    expect(s.world.gasStorageGap.eu - eu).toBeGreaterThan(3);
    expect(s.news.some((n) => n.headline === "Test shock")).toBe(true);
  });
});

describe("the refinery", () => {
  it("prices the margin per barrel from yields, cracks and the slate, and realises it daily in cash and in the refinery leg", () => {
    const spec = tier4(994, { days: 12, refinery: { slate: "WTI_MIDLAND", runs: 0.9 } });
    const s0 = newGame(spec, 2, { par: 0 });
    expect(s0.refinery).not.toBeNull();
    const m = refineryMarginPerBbl(s0, "WTI_MIDLAND");
    const y = REFINERY.yields.value.WTI_MIDLAND;
    const revenue = y.gasoline * m.products.gasoline.price + y.diesel * m.products.diesel.price + y.jet * m.products.jet.price + y.fuelOil * m.products.fuelOil.price;
    expect(m.perBbl).toBeCloseTo(revenue - m.crude - m.delivered - m.opex, 9);
    expect(m.why).toMatch(/stylised/);
    const sour = refineryMarginPerBbl(s0, "ARAB_LIGHT");
    expect(Number.isFinite(sour.perBbl)).toBe(true);
    const { s, checks } = run(spec, 2, () => []);
    for (const c of checks) expect(Math.abs(c.gap), `tick ${c.tick}`).toBeLessThan(0.01);
    expect(s.refinery!.history.length).toBe(12);
    const rows = s.pnl.attribution.filter((r) => r.leg === "refinery");
    expect(rows.length).toBe(12);
    const cash = s.finance.ledger.filter((r) => r.text.startsWith("Refinery day")).reduce((a, r) => a + r.amount, 0);
    expect(cash).toBeCloseTo(rows.reduce((a, r) => a + r.amount, 0), 6);
    expect(cash).toBeCloseTo(s.refinery!.marginUsd, 6);
    expect(s.refinery!.history[0].crudeBbl).toBe(REFINERY.capacityKbd.value * 1000 * 0.9);
  });
  it("runs and slate are decisions; a hurricane shuts the plant and a turnaround caps it at half", () => {
    const spec = tier4(995, { days: 20, refinery: { slate: "WTI_MIDLAND", runs: 1 }, events: [
      { id: "h", kind: "hurricane", day: 3, hour: 10, params: { days: 3 } },
      { id: "t", kind: "plant_maintenance", day: 10, hour: 9, params: { days: 4 } },
    ] });
    const { s, refused } = run(spec, 3, (st) => {
      if (st.tick === 2) return [{ type: "set_runs", player: P, runs: 0.8 }, { type: "set_slate", player: P, grade: "ARAB_LIGHT" }];
      return [];
    });
    expect(refused).toEqual([]);
    const h = s.refinery!.history;
    expect(h.find((x) => x.day === 1)!.runs).toBe(0.8);
    expect(s.refinery!.slate).toBe("ARAB_LIGHT");
    expect(h.find((x) => x.day === 4)!.runs).toBe(0); // shut
    expect(h.find((x) => x.day === 4)!.marginUsd).toBeLessThan(0); // fixed cost still paid
    expect(h.find((x) => x.day === 7)!.runs).toBe(0.8); // back
    expect(h.find((x) => x.day === 11)!.runs).toBe(REFINERY.turnaroundRuns.value);
    expect(s.portCongestion.HOUSTON).toBeGreaterThan(3 * 24);
    expect(s.news.some((n) => /Hurricane/.test(n.headline))).toBe(true);
    expect(effectiveRuns(s)).toBe(0.8);
  });
  it("a 3-2-1 package's flat and basis parts cancel: the hedge lands in the crack leg; held units and the target are counted", () => {
    const spec = tier4(996, { days: 15, refinery: { slate: "WTI_MIDLAND", runs: 0.9 } });
    const s0 = newGame(spec, 6, { par: 0 });
    const m = { RBOB: s0.listed.RBOB[1], ULSD: s0.listed.ULSD[1], WTI: s0.listed.WTI[1] };
    const { s, checks } = run(spec, 6, (st) => st.tick === 10 ? [{ type: "spread", player: P, name: "crack321", legs: [{ inst: "RBOB", month: m.RBOB, side: "sell", qty: 40 }, { inst: "ULSD", month: m.ULSD, side: "sell", qty: 20 }, { inst: "WTI", month: m.WTI, side: "buy", qty: 60 }] }] : []);
    for (const c of checks) expect(Math.abs(c.gap)).toBeLessThan(0.01);
    const tot = attributionTotals(s.pnl.attribution);
    const paper = s.pnl.attribution.filter((r) => r.month !== "plant" && r.leg === "flat").reduce((a, r) => a + r.amount, 0);
    expect(Math.abs(paper)).toBeLessThan(Math.abs(tot.crack) * 0.05 + 50);
    expect(crackUnitsHeld(s).units).toBe(-20);
    expect(crackHedgeTargetUnits(s, 30)).toBe(Math.round((REFINERY.capacityKbd.value * 1000 * 0.9 * 30) / 3000));
  });
});

describe("gas and LNG", () => {
  it("prices JKM as TTF in dollars per MMBtu plus the Asian premium, and the conversions are enforced", () => {
    const spec = tier4(997);
    const s = newGame(spec, 8, { par: 0 });
    const jkm = priceParts(s.factors, "JKM", 1);
    const ttfUsd = ttfUsdMmbtu(s.factors.ttfPrompt, s.factors.eurusd);
    expect(jkm.parts.flat).toBeCloseTo(ttfUsd, 9);
    expect(jkm.parts.basis).toBeCloseTo(s.factors.jkmPremium, 9);
    expect(jkm.price).toBeGreaterThan(ttfUsd);
    expect(eurMwhToUsdMmbtu(35, 1.1)).toBeCloseTo((35 * 1.1) / 3.412, 9);
    expect(usdMmbtuToEurMwh(eurMwhToUsdMmbtu(35, 1.1), 1.1)).toBeCloseTo(35, 9);
    // a TTF-priced cargo leg decomposes into flat, fx and time spread; the fx part is zero at the opening rate
    const bp = basisParts(s, "TTF", 3);
    expect(bp.flat).toBeCloseTo(ttfUsdMmbtu(s.factors.ttfPrompt, s.fx0), 9);
    expect(Math.abs(bp.fx)).toBeLessThan(1e-9);
    expect(s.listed.JKM.length).toBe(12);
    expect(s.quotes[ckey("JKM", s.listed.JKM[0])].mid).toBeGreaterThan(0);
  });
  it("an LNG cargo is bought FOB in MMBtu at Henry Hub plus the fee, shipped on an LNG carrier, and delivered DES on TTF with an FX leg, boil-off, regas and a euro invoice", () => {
    const spec = tier4(998, { days: 45, events: [
      { id: "fob", kind: "tender", day: 0, hour: 9, params: { counterparty: "GULF_LNG", side: "offer", grade: "LNG", incoterm: "FOB", port: "SABINE_PASS", basis: "HH", windowKind: "after_bl", windowDays: 5, laycanStart: 3, laycanDays: 2, openHours: 48 } },
      { id: "des", kind: "tender", day: 1, hour: 10, params: { counterparty: "NORTHGAS", side: "bid", grade: "LNG", incoterm: "DES", port: "GATE", basis: "TTF", windowKind: "after_discharge", windowDays: 5, laycanStart: 18, laycanDays: 8, openHours: 96 } },
    ] });
    let booked = false;
    const { s, checks, refused } = run(spec, 11, (st) => {
      const acts: Action[] = [];
      const offer = st.tenders.find((t) => t.status === "open" && t.side === "offer");
      if (offer && st.cargoes.length === 0) acts.push({ type: "accept_tender", player: P, tenderId: offer.id });
      const c = st.cargoes[0];
      if (c && !c.vesselId && c.status === "contracted") { const q = charterQuotes(st, c).find((x) => x.fits && x.etaLoadDay <= c.laycan[1]); if (q) acts.push({ type: "fix_charter", player: P, cargoId: c.id, vesselId: q.vesselId }); }
      const bid = st.tenders.find((t) => t.status === "open" && t.side === "bid");
      if (c && bid && !c.sale) acts.push({ type: "accept_tender", player: P, tenderId: bid.id, cargoId: c.id });
      if (c && !booked && c.status === "laden") { booked = true; acts.push({ type: "book_regas", player: P, cargoId: c.id }); }
      return acts;
    });
    expect(refused).toEqual([]);
    for (const c of checks) expect(Math.abs(c.gap), `tick ${c.tick}`).toBeLessThan(0.01);
    const c = s.cargoes[0];
    expect(c.grade).toBe("LNG");
    expect(c.bbl).toBe(LNG.cargoMmbtu.value);
    expect(c.purchase.basis).toBe("HH");
    expect(c.purchase.diff).toBeGreaterThan(LNG.liquefactionFee.value - 0.2);
    const vessel = s.vessels.find((v) => v.id === c.vesselId)!;
    expect(vessel.cls).toBe("LNGC");
    expect(charterQuotes(newGame(spec, 11, { par: 0 }), { ...c, vesselId: null }).filter((q) => q.fits).every((q) => q.cls === "LNGC")).toBe(true);
    expect(c.status).toBe("delivered");
    expect(c.regasBooked).toBe(true);
    expect(c.boilOffUsd).toBeGreaterThan(0);
    expect(c.sale!.basis).toBe("TTF");
    expect(c.sale!.fixed).not.toBeNull();
    expect(s.finance.ledger.some((r) => r.currency === "EUR" && /Received EUR/.test(r.text))).toBe(true);
    expect(s.finance.ledger.some((r) => /Regasification/.test(r.text))).toBe(true);
    expect(s.pnl.attribution.some((r) => r.leg === "fx" && /TTF|euro/i.test(r.text))).toBe(true);
    // conversions enforced: the physical exposure of the sale leg is in MMBtu on the TTF basis; the TTF hedge is MMBtu / 3.412 / 720 lots
    const before = newGame(spec, 11, { par: 0 });
    void before;
    const mmbtu = LNG.cargoMmbtu.value;
    const ttfLots = mmbtu / CONVERSIONS.MMBTU_PER_MWH.value / INSTRUMENTS.TTF.lot;
    expect(Math.round(ttfLots)).toBe(1465);
    const hhLots = mmbtu / INSTRUMENTS.HH.lot;
    expect(hhLots).toBe(360);
  });
  it("physical exposure splits by basis so a gas cargo's hedge is sized in the right contract, and VaR puts it on the gas hub", () => {
    const spec = tier4(999, { days: 10, events: [{ id: "fob", kind: "tender", day: 0, hour: 9, params: { counterparty: "GULF_LNG", side: "offer", grade: "LNG", incoterm: "FOB", port: "SABINE_PASS", basis: "HH", windowKind: "after_bl", windowDays: 5, laycanStart: 5, laycanDays: 2, openHours: 48 } }] });
    let s = newGame(spec, 12, { par: 0 });
    const rng = makeRng(12);
    for (let i = 0; i < 10; i++) s = tick(s, [], rng).state;
    const offer = s.tenders.find((t) => t.status === "open")!;
    s = applyActions(s, [{ type: "accept_tender", player: P, tenderId: offer.id }], rng).state;
    const e = physicalExposureBbl(s);
    expect(e.bbl).toBe(0);
    expect(e.byBasis.HH).toBeCloseTo(-LNG.cargoMmbtu.value, 6);
    expect(e.byBasis.TTF).toBeCloseTo(LNG.cargoMmbtu.value, 6);
    expect(bookVar(s)!.why).toMatch(/HH/);
    expect(bookVar(s)!.why).toMatch(/TTF/);
    expect(Number.isFinite(s.pnl.total)).toBe(true);
    void cargoesMarkUsd; void tanksMarkUsd; void unrealised;
    const m = legMark(s, s.cargoes[0], s.cargoes[0].purchase);
    expect(m.perBbl).toBeCloseTo(s.factors.hhPrompt + s.cargoes[0].purchase.diff, 0);
  });
  it("a gas storage release moves Henry Hub by the surprise and a cold snap lifts TTF and drains European storage", () => {
    const spec = tier4(1000, { days: 12, events: [
      { id: "gas", kind: "gas_storage_release", day: 3, hour: 14 },
      { id: "cold", kind: "cold_snap", day: 5, hour: 9, params: { hdd: 6, days: 4, pct: 0.08 } },
    ] });
    const { s } = run(spec, 13, () => []);
    const rel = s.releases.find((r) => r.name === "Weekly US gas storage")!;
    expect(rel.published).toBe(true);
    expect(rel.consensus).not.toBeNull();
    expect(rel.actual).not.toBeNull();
    const cold = s.news.find((n) => /Cold snap/.test(n.headline))!;
    expect(cold).toBeDefined();
    const beforeIdx = s.history.findIndex((h) => h.day - s.startDay >= 5);
    const ttfBefore = s.history[beforeIdx - 1].factors.ttfPrompt;
    const ttfAfter = s.history[beforeIdx].factors.ttfPrompt;
    expect(ttfAfter / ttfBefore).toBeGreaterThan(1.04);
    expect(s.world.hddAnomaly.eu).toBeGreaterThan(1);
  });
});

describe("signals and information degradation", () => {
  it("a series leaves its baseline before its event, the headline arrives after the delay, and a trade in the window counts", () => {
    const spec = tier4(1001, { days: 20, infoDelayHours: 24, feedIncluded: true, events: [
      { id: "fire", kind: "refinery_fire", day: 8, hour: 11, params: { days: 6, signal: "hotspot" } },
      { id: "trans", kind: "chokepoint", day: 12, hour: 9, params: { id: "HORMUZ", status: "restricted", signal: "transits" } },
    ] });
    const s0 = newGame(spec, 14, { par: 0 });
    expect(s0.signals.length).toBe(2);
    const hot = s0.signals.find((x) => x.kind === "hotspot")!;
    expect(hot.firstMoveTick).toBe(8 * 24 + 11 - 2);
    expect(signalShape(hot, hot.firstMoveTick - 1)).toBe(0);
    expect(signalShape(hot, hot.eventTick)).toBe(1);
    let traded = false;
    const { s } = run(spec, 14, (st) => {
      const t = st.signals.find((x) => x.kind === "transits")!;
      if (!traded && st.tick >= t.firstMoveTick + 24 && st.tick < t.eventTick) { traded = true; return [{ type: "order", player: P, inst: "BRENT", month: st.listed.BRENT[1], side: "buy", qty: 20, kind: "market", tag: "signal" }]; }
      return [];
    });
    const h = s.signals.find((x) => x.kind === "hotspot")!;
    expect(h.headlineTick).toBe(h.eventTick + 24);
    const atEvent = h.series.filter((p) => p.tick >= h.firstMoveTick && p.tick <= h.eventTick).map((p) => p.v);
    expect(Math.max(...atEvent)).toBeGreaterThan(h.baseline + 3);
    const quiet = h.series.filter((p) => p.tick < h.firstMoveTick - 24).map((p) => p.v);
    expect(quiet.reduce((a, b) => a + b, 0) / quiet.length).toBeLessThan(h.baseline + 1.5);
    const headline = s.news.find((n) => /Jamnagar/.test(n.headline))!;
    expect(headline.tick).toBe(h.eventTick + 24);
    expect(headline.shockTick).toBe(h.eventTick);
    const t = s.signals.find((x) => x.kind === "transits")!;
    expect(t.series.filter((p) => p.tick >= t.eventTick - 24 && p.tick <= t.eventTick).every((p) => p.v < t.baseline - 8)).toBe(true);
    const trades = signalTrades(s);
    expect(trades.find((x) => x.signal.kind === "transits")!.fills.length).toBe(1);
    expect(trades.find((x) => x.signal.kind === "hotspot")!.fills.length).toBe(0);
    expect(s.events.some((e) => e.kind === "refinery_fire_end")).toBe(true);
  });
  it("the feed costs money and is a ledger row; the series exist either way so a replay is identical", () => {
    const spec = tier4(1002, { days: 3, events: [{ id: "cold", kind: "cold_snap", day: 2, hour: 9, params: { signal: "cold_forecast" } }] });
    const s = newGame(spec, 1, { par: 0 });
    expect(s.feedBought).toBe(false);
    expect(s.signals.length).toBe(1);
    const r = applyActions(s, [{ type: "buy_feed", player: P }], makeRng(1));
    expect(r.refused.length).toBe(0);
    expect(r.state.feedBought).toBe(true);
    expect(r.state.finance.ledger.find((x) => /feed/.test(x.text))!.amount).toBe(-SIGNALS.feedCostUsd.value);
    expect(applyActions(r.state, [{ type: "buy_feed", player: P }], makeRng(1)).refused[0].reason).toMatch(/already/);
  });
});

describe("tier 4 liquidity", () => {
  it("thin back months: the depth knob cuts the third month and beyond, never the front", () => {
    const thin = newGame(tier4(1003, { backMonthDepth: 0.4 }), 1, { par: 0 });
    const full = newGame(tier4(1004), 1, { par: 0 });
    expect(thin.quotes[ckey("BRENT", thin.listed.BRENT[0])].depth).toBe(full.quotes[ckey("BRENT", full.listed.BRENT[0])].depth);
    expect(thin.quotes[ckey("BRENT", thin.listed.BRENT[4])].depth).toBeLessThan(full.quotes[ckey("BRENT", full.listed.BRENT[4])].depth);
    expect(thin.quotes[ckey("BRENT", thin.listed.BRENT[4])].why).toMatch(/thin/);
    void lotValueUsd; void HOURS_PER_DAY;
  });
});
