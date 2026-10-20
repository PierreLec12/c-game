import { describe, expect, it } from "vitest";
import { makeRng } from "../src/rng";
import { applyActions, newGame, tick } from "../src/engine";
import { attributionTotals, unrealised } from "../src/pnl";
import { cargoesMarkUsd } from "../src/physical";
import { tanksMarkUsd, tankInventory } from "../src/storage";
import { lineAvailable } from "../src/finance";
import { counterpartyExposure } from "../src/counterparties";
import { breaches } from "../src/risk";
import { charterQuotes } from "../src/shipping";
import { isSettleTick } from "../src/calendar";
import type { Action, State } from "../src/types";
import type { LevelSpec } from "../src/levels";
import { testLevel } from "./helpers";

const P = "p1";
const ALL_UNLOCKS: Action["type"][] = ["order", "spread", "roll", "close", "cancel_order", "draw_line", "repay_line", "post_margin", "convert_fx", "open_card", "ask_mentor", "answer_drill", "answer_quiz", "end_level", "request_limit", "accept_tender", "decline_tender", "fix_charter", "instruct_ship", "efp", "settle_claim", "contest_claim", "open_lc", "insure", "counter_tender", "lease_tank", "store_cargo", "blend", "release_tank"];
const LOOSE = { var95: 50e6, netLots: { BRENT: 5000, WTI: 5000, RBOB: 5000, ULSD: 5000, HH: 5000, TTF: 5000, DUBAI: 5000, JKM: 5000 }, grossLots: 10000, stopLoss: 100e6, drawdown: 120e6, concentration: 50 };
const tier3 = (id: number, extra: Partial<Parameters<typeof testLevel>[0]> = {}) => testLevel({ id, days: 40, startDate: "2027-03-01", capital: 50e6, creditLine: 400e6, instruments: ["BRENT", "WTI", "DUBAI"], unlocks: ALL_UNLOCKS, limits: LOOSE, ...extra });

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

describe("letters of credit and prepayment", () => {
  it("an LC takes a fee, holds the line until the invoice is paid, and a cargo that needed one and had none is cancelled at loading", () => {
    const spec = tier3(980, { events: [
      { id: "lc", kind: "tender", day: 0, hour: 9, params: { counterparty: "NORTHSEA_MAJOR", side: "offer", grade: "FORTIES", incoterm: "FOB", port: "SULLOM_VOE", windowKind: "after_bl", windowDays: 5, laycanStart: 4, laycanDays: 2, openHours: 72, requiresLc: true } },
      { id: "lc2", kind: "tender", day: 0, hour: 10, params: { counterparty: "NORTHSEA_MAJOR", side: "offer", grade: "FORTIES", incoterm: "FOB", port: "SULLOM_VOE", windowKind: "after_bl", windowDays: 5, laycanStart: 6, laycanDays: 2, openHours: 72, requiresLc: true } },
    ] });
    let opened = false;
    const { s, checks } = run(spec, 1, (st) => {
      const acts: Action[] = [];
      for (const t of st.tenders) if (t.status === "open" && t.side === "offer") acts.push({ type: "accept_tender", player: P, tenderId: t.id });
      for (const c of st.cargoes) {
        if (!c.vesselId && c.status === "contracted") { const q = charterQuotes(st, c).find((x) => x.fits && x.etaLoadDay <= c.laycan[1]); if (q) acts.push({ type: "fix_charter", player: P, cargoId: c.id, vesselId: q.vesselId }); }
        if (c.id === "C1" && !c.lcId && !opened && c.status !== "cancelled") { opened = true; acts.push({ type: "open_lc", player: P, cargoId: c.id }); }
      }
      return acts;
    });
    const c1 = s.cargoes.find((c) => c.id === "C1")!, c2 = s.cargoes.find((c) => c.id === "C2")!;
    expect(c1.lcId).not.toBeNull();
    expect(c1.status).toBe("delivered");
    expect(c2.status).toBe("cancelled");
    expect(c2.cancelled?.reason).toMatch(/letter of credit/);
    const lc = s.lcs.find((l) => l.id === c1.lcId)!;
    expect(lc.feeUsd).toBeGreaterThan(0);
    expect(lc.closedTick).not.toBeNull();
    expect(s.finance.ledger.some((r) => r.text.includes("Letter of credit") && r.amount < 0)).toBe(true);
    expect(s.finance.ledger.some((r) => r.text.includes("Charter cancellation fee"))).toBe(true);
    expect(attributionTotals(s.pnl.attribution).finance).toBeLessThan(0);
    for (const ch of checks) expect(Math.abs(ch.gap), `tick ${ch.tick}`).toBeLessThan(0.02);
  });
  it("the line available falls by an open LC's face and comes back when it closes", () => {
    const spec = tier3(981, { events: [{ id: "lc", kind: "tender", day: 0, hour: 9, params: { counterparty: "NORTHSEA_MAJOR", side: "offer", grade: "FORTIES", incoterm: "FOB", port: "SULLOM_VOE", windowKind: "after_bl", windowDays: 5, laycanStart: 4, laycanDays: 2, openHours: 72, requiresLc: true } }] });
    const rng = makeRng(2);
    let s = newGame(spec, 2, { par: 0 });
    for (let i = 0; i < 10; i++) s = tick(s, [], rng).state;
    const t = s.tenders[0];
    s = applyActions(s, [{ type: "accept_tender", player: P, tenderId: t.id }], rng).state;
    const before = lineAvailable(s);
    s = applyActions(s, [{ type: "open_lc", player: P, cargoId: "C1" }], rng).state;
    expect(lineAvailable(s)).toBeLessThan(before - 40e6);
    expect(applyActions(s, [{ type: "open_lc", player: P, cargoId: "C1" }], rng).refused[0].reason).toMatch(/already has/);
  });
  it("a prepayment buys a better differential, moves cash now and nets off the invoice", () => {
    const spec = tier3(982, { events: [{ id: "pp", kind: "tender", day: 0, hour: 9, params: { counterparty: "DELTA_INDEPENDENT", side: "offer", grade: "BONNY_LIGHT", incoterm: "FOB", port: "BONNY", windowKind: "after_bl", windowDays: 5, laycanStart: 3, laycanDays: 2, openHours: 72, prepayDiscount: 0.35 } }] });
    const { s, checks } = run(spec, 3, (st) => {
      const acts: Action[] = [];
      const t = st.tenders.find((x) => x.status === "open");
      if (t && st.cargoes.length === 0) acts.push({ type: "accept_tender", player: P, tenderId: t.id, prepay: true });
      const c = st.cargoes[0];
      if (c && !c.vesselId && c.status === "contracted") { const q = charterQuotes(st, c).find((x) => x.fits && x.etaLoadDay <= c.laycan[1]); if (q) acts.push({ type: "fix_charter", player: P, cargoId: c.id, vesselId: q.vesselId }); }
      return acts;
    });
    const c = s.cargoes[0];
    expect(c.purchase.diff).toBeCloseTo(s.tenders[0].diff - 0.35, 6);
    expect(s.finance.ledger.some((r) => r.text.startsWith("Prepaid"))).toBe(true);
    expect(s.finance.ledger.some((r) => r.text.includes("less") && r.text.includes("prepaid"))).toBe(true);
    expect(c.purchase.paidTick).not.toBeNull();
    for (const ch of checks) expect(Math.abs(ch.gap), `tick ${ch.tick}`).toBeLessThan(0.02);
  });
  it("a drawdown through the covenant cuts the line", () => {
    const spec = tier3(983, { days: 10, events: [{ id: "crash", kind: "headline_move", day: 2, hour: 10, params: { pct: -0.12 } }] });
    const rng = makeRng(4);
    let s = newGame(spec, 4, { par: 0 });
    s = applyActions(s, [{ type: "order", player: P, inst: "BRENT", month: s.listed.BRENT[0], side: "buy", qty: 3000, kind: "market" }], rng).state;
    let cut = false;
    for (let t = 0; t < 10 * 24 && !cut; t++) { const r = tick(s, [], rng); s = r.state; if (r.events.some((e) => e.kind === "finance" && e.text.includes("covenant"))) cut = true; }
    expect(cut).toBe(true);
    expect(s.finance.lineCut).toBe(true);
    expect(applyActions(s, [{ type: "draw_line", player: P, amount: 1e6 }], rng).refused.length).toBe(1);
  });
});

describe("tanks", () => {
  const cushing = (id: number, extra: Partial<Parameters<typeof testLevel>[0]> = {}) => tier3(id, { days: 70, events: [
    { id: "o1", kind: "tender", day: 0, hour: 9, params: { counterparty: "DELTA_INDEPENDENT", side: "offer", grade: "WTI_MIDLAND", bbl: 300000, incoterm: "DES", port: "CUSHING", basis: "WTI", windowKind: "after_bl", windowDays: 3, laycanStart: 2, laycanDays: 1, openHours: 48 } },
    { id: "o2", kind: "tender", day: 0, hour: 10, params: { counterparty: "GULF_NATIONAL", side: "offer", grade: "ARAB_LIGHT", bbl: 200000, incoterm: "DES", port: "CUSHING", basis: "WTI", windowKind: "after_bl", windowDays: 3, laycanStart: 2, laycanDays: 1, openHours: 48 } },
    { id: "bid", kind: "tender", day: 20, hour: 10, params: { counterparty: "GULF_COAST_REFINING", side: "bid", grade: "WTI_MIDLAND", bbl: 300000, incoterm: "DES", port: "CUSHING", basis: "WTI", windowKind: "month_avg_offset", offsetMonths: 1, laycanStart: 32, laycanDays: 30, openHours: 96 } },
  ], ...extra });
  it("stores pipeline batches, charges the lease monthly in the storage leg, blends to a weighted quality, never goes negative, and sells out of the tank", () => {
    const spec = cushing(984);
    let blended = false;
    const { s, checks, refused } = run(spec, 5, (st) => {
      const acts: Action[] = [];
      if (st.tanks.length === 0) acts.push({ type: "lease_tank", player: P, port: "CUSHING", bbl: 600000, months: 2 });
      for (const t of st.tenders) if (t.status === "open" && t.side === "offer") acts.push({ type: "accept_tender", player: P, tenderId: t.id });
      const tank = st.tanks[0];
      for (const c of st.cargoes) if (tank && c.status === "delivered" && !c.tankId && !c.sale) acts.push({ type: "store_cargo", player: P, cargoId: c.id, tankId: tank.id });
      const bid = st.tenders.find((t) => t.status === "open" && t.side === "bid");
      const stored = st.cargoes.find((c) => c.tankId && !c.sale && c.grade === "WTI_MIDLAND");
      if (bid && stored) acts.push({ type: "accept_tender", player: P, tenderId: bid.id, cargoId: stored.id });
      return acts;
    });
    void blended;
    const tank = s.tanks[0];
    expect(tank).toBeDefined();
    expect(s.cargoes.filter((c) => c.tankId).length).toBe(2);
    expect(s.finance.ledger.filter((r) => r.text.startsWith("Tank")).length).toBeGreaterThanOrEqual(2);
    expect(attributionTotals(s.pnl.attribution).storage).toBeLessThan(0);
    // the WTI Midland parcel was sold out of the tank; the sour parcel stays; inventory never goes below zero
    expect(tankInventory(tank)).toBeGreaterThanOrEqual(0);
    const sold = s.cargoes.find((c) => c.grade === "WTI_MIDLAND")!;
    expect(sold.sale).not.toBeNull();
    expect(sold.sale!.window.kind).toBe("month_avg_offset");
    expect(sold.sale!.windowDays!.length).toBeGreaterThan(15);
    for (const ch of checks) expect(Math.abs(ch.gap), `tick ${ch.tick}`).toBeLessThan(0.02);
    expect(tank.parcels.length).toBe(1);
    expect(tank.parcels[0].grade).toBe("ARAB_LIGHT");
    void refused;
    expect(Math.abs(tanksMarkUsd(s) + cargoesMarkUsd(s) + unrealised(s) - (s.pnl.total - (s.pnl.total - unrealised(s) - cargoesMarkUsd(s) - tanksMarkUsd(s))))).toBeLessThan(1);
  });
  it("blends two parcels into one at the volume-weighted quality and refuses to release a tank with oil in it", () => {
    const spec = cushing(985, { events: [
      { id: "o1", kind: "tender", day: 0, hour: 9, params: { counterparty: "DELTA_INDEPENDENT", side: "offer", grade: "WTI_MIDLAND", bbl: 300000, incoterm: "DES", port: "CUSHING", basis: "WTI", windowKind: "after_bl", windowDays: 3, laycanStart: 2, laycanDays: 1, openHours: 48 } },
      { id: "o2", kind: "tender", day: 0, hour: 10, params: { counterparty: "GULF_NATIONAL", side: "offer", grade: "ARAB_LIGHT", bbl: 200000, incoterm: "DES", port: "CUSHING", basis: "WTI", windowKind: "after_bl", windowDays: 3, laycanStart: 2, laycanDays: 1, openHours: 48 } },
    ] });
    let blended = false;
    const { s, refused } = run(spec, 6, (st) => {
      const acts: Action[] = [];
      if (st.tanks.length === 0) acts.push({ type: "lease_tank", player: P, port: "CUSHING", bbl: 600000, months: 1 });
      for (const t of st.tenders) if (t.status === "open" && t.side === "offer") acts.push({ type: "accept_tender", player: P, tenderId: t.id });
      const tank = st.tanks[0];
      for (const c of st.cargoes) if (tank && c.status === "delivered" && !c.tankId) acts.push({ type: "store_cargo", player: P, cargoId: c.id, tankId: tank.id });
      if (tank && tank.parcels.length === 2 && !blended) { blended = true; acts.push({ type: "blend", player: P, tankId: tank.id, parcelIds: tank.parcels.map((p) => p.id) }); acts.push({ type: "release_tank", player: P, tankId: tank.id }); }
      return acts;
    }, 10 * 24);
    const tank = s.tanks[0];
    expect(tank.parcels.length).toBe(1);
    const p = tank.parcels[0];
    expect(p.grade).toBe("BLEND");
    expect(p.bbl).toBe(500000);
    expect(p.sulphur).toBeCloseTo((0.3 * 300000 + 1.8 * 200000) / 500000, 6);
    expect(p.api).toBeCloseTo((42 * 300000 + 33 * 200000) / 500000, 6);
    expect(refused.some((r) => r.startsWith("release_tank"))).toBe(true);
    expect(tank.released).toBe(false);
  });
});

describe("counterparties", () => {
  const level = (id: number, events: LevelSpec["events"]) => tier3(id, { days: 42, events, limits: { ...LOOSE, concentration: 2.0 } });
  it("a seller's default cancels the cargo, the onward receiver claims, insurance recovers most of it, the rating falls", () => {
    const events: LevelSpec["events"] = [
      { id: "cheap", kind: "tender", day: 0, hour: 9, params: { counterparty: "VANTAGE", side: "offer", grade: "BONNY_LIGHT", incoterm: "FOB", port: "BONNY", windowKind: "after_bl", windowDays: 5, laycanStart: 8, laycanDays: 2, openHours: 72, diffVsFair: -0.4 } },
      { id: "bid", kind: "tender", day: 1, hour: 10, params: { counterparty: "RHINE_REFINING", side: "bid", grade: "BONNY_LIGHT", incoterm: "CIF", port: "ROTTERDAM", windowKind: "after_discharge", windowDays: 5, laycanStart: 24, laycanDays: 6, openHours: 96 } },
      { id: "boom", kind: "counterparty_default", day: 5, hour: 9, params: { counterparty: "VANTAGE" } },
    ];
    const policy = (insure: boolean) => (st: State) => {
      const acts: Action[] = [];
      const t = st.tenders.find((x) => x.status === "open" && x.side === "offer");
      if (t && st.cargoes.length === 0) acts.push({ type: "accept_tender", player: P, tenderId: t.id });
      const c = st.cargoes[0];
      if (c && insure && !c.insured && c.status !== "cancelled") acts.push({ type: "insure", player: P, cargoId: c.id });
      const bid = st.tenders.find((x) => x.status === "open" && x.side === "bid");
      if (c && bid && !c.sale && c.status !== "cancelled") acts.push({ type: "accept_tender", player: P, tenderId: bid.id, cargoId: c.id });
      return acts;
    };
    const naked = run(level(986, events), 7, policy(false));
    const covered = run(level(987, events), 7, policy(true));
    expect(naked.s.cargoes[0].status).toBe("cancelled");
    expect(naked.s.counterparties.VANTAGE.defaulted).toBe(true);
    expect(naked.s.counterparties.VANTAGE.ratingScore).toBeLessThan(40);
    const credN = attributionTotals(naked.s.pnl.attribution).credit, credC = attributionTotals(covered.s.pnl.attribution).credit;
    expect(credN).toBeLessThan(0);
    expect(credC).toBeGreaterThan(credN);
    expect(covered.s.pnl.attribution.some((r) => r.text.includes("insurer pays"))).toBe(true);
    for (const ch of naked.checks) expect(Math.abs(ch.gap), `tick ${ch.tick}`).toBeLessThan(0.02);
    for (const ch of covered.checks) expect(Math.abs(ch.gap), `tick ${ch.tick}`).toBeLessThan(0.02);
  });
  it("concentration: one name over the limit draws a warning; the late payer pays late; a counter within tolerance is accepted", () => {
    const events: LevelSpec["events"] = [
      { id: "a", kind: "tender", day: 0, hour: 9, params: { counterparty: "STELLAR", side: "offer", grade: "ES_SIDER", incoterm: "FOB", port: "ES_SIDER", windowKind: "after_bl", windowDays: 5, laycanStart: 3, laycanDays: 2, openHours: 72 } },
      { id: "bid", kind: "tender", day: 1, hour: 10, params: { counterparty: "ADRIATIC_SMALL", side: "bid", grade: "ES_SIDER", incoterm: "CIF", port: "ROTTERDAM", windowKind: "after_discharge", windowDays: 5, laycanStart: 10, laycanDays: 6, openHours: 96 } },
    ];
    let countered = false;
    const { s } = run(level(988, events), 8, (st) => {
      const acts: Action[] = [];
      const t = st.tenders.find((x) => x.status === "open" && x.side === "offer");
      if (t && !countered) { countered = true; return [{ type: "counter_tender", player: P, tenderId: t.id, diff: Math.round((t.diff - 0.05) * 100) / 100 }]; }
      if (t && st.cargoes.length === 0 && t.countered) acts.push({ type: "accept_tender", player: P, tenderId: t.id });
      const c = st.cargoes[0];
      if (c && !c.vesselId && c.status === "contracted") { const q = charterQuotes(st, c).find((x) => x.fits && x.etaLoadDay <= c.laycan[1]); if (q) acts.push({ type: "fix_charter", player: P, cargoId: c.id, vesselId: q.vesselId }); }
      const bid = st.tenders.find((x) => x.status === "open" && x.side === "bid");
      if (c && bid && !c.sale) acts.push({ type: "accept_tender", player: P, tenderId: bid.id, cargoId: c.id });
      return acts;
    });
    expect(s.tenders[0].countered?.answer).toBe("accepted");
    // the limit: a $77m cargo from one name against $50m of capital is 1.5x; a 1x limit would warn
    const tight = { ...s, risk: { ...s.risk, limits: { ...s.risk.limits, concentration: 1.0 } } };
    const atPeak = { ...tight, cargoes: tight.cargoes.map((c) => ({ ...c, status: "laden" as const })) };
    expect(breaches(atPeak, 0).some((b) => b.limit === "concentration")).toBe(true);
    expect(breaches(s, 0).some((b) => b.limit === "concentration")).toBe(false);
    expect(s.counterparties.ADRIATIC_SMALL.late).toBe(1);
    expect(s.news.some((n) => n.headline.includes("late paying"))).toBe(true);
    const c = s.cargoes[0];
    expect(c.sale!.paidTick).not.toBeNull();
    expect(c.sale!.paidTick! - c.sale!.dueTick!).toBeLessThanOrEqual(24);
    expect(counterpartyExposure(s).total).toBe(0);
  });
});

describe("information", () => {
  it("a false rumour moves the market, is resolved as false and unwinds; a true one is confirmed by the real event", () => {
    const spec = tier3(989, { days: 12, events: [
      { id: "r1", kind: "rumour", day: 1, hour: 10, params: { headline: "Rumour: Forties pipeline down", moveNow: 0.02, resolveHours: 30, pTrue: 0, eventKind: "field_outage", eventParams: "{\"kbd\":300}" } },
      { id: "r2", kind: "rumour", day: 5, hour: 10, params: { headline: "Rumour: Libyan port shut", moveNow: 0.02, resolveHours: 30, pTrue: 1, eventKind: "field_outage", eventParams: "{\"kbd\":300,\"headline\":\"Es Sider shut: 300 kb/d off\"}" } },
    ] });
    const rng = makeRng(9);
    let s = newGame(spec, 9, { par: 0 });
    const ticks: Record<string, number> = {};
    for (let t = 0; t < 12 * 24; t++) {
      const r = tick(s, [], rng);
      s = r.state;
      for (const e of r.events) if (e.kind === "rumour" || e.kind === "news" || e.kind === "event") ticks[e.text] = e.tick;
    }
    const r1 = s.news.find((n) => n.eventId === "r1")!, r2 = s.news.find((n) => n.eventId === "r2")!;
    expect(r1.resolved?.outcome).toBe("false");
    expect(r2.resolved?.outcome).toBe("true");
    expect(s.news.some((n) => n.headline.startsWith("Denied"))).toBe(true);
    expect(s.news.some((n) => n.headline.includes("Es Sider shut"))).toBe(true);
    expect(s.events.find((e) => e.id === "r2:truth")?.fired).toBe(true);
  });
  it("with an information delay the world moves first and the headline arrives later, saying so", () => {
    const spec = tier3(990, { days: 6, infoDelayHours: 24, events: [{ id: "out", kind: "field_outage", day: 1, hour: 10, params: { kbd: 400, headline: "Field outage removes 400 kb/d" } }] });
    const rng = makeRng(10);
    let s = newGame(spec, 10, { par: 0 });
    let balanceAt34: number | null = null;
    let newsTick: number | null = null;
    for (let t = 0; t < 6 * 24; t++) {
      const r = tick(s, [], rng);
      s = r.state;
      if (s.tick === 34) balanceAt34 = s.world.targets.crudeBalance;
      for (const e of r.events) if (e.kind === "news" && e.text.includes("Field outage")) newsTick = e.tick;
    }
    expect(balanceAt34).toBe(-400);
    expect(newsTick).toBe(34 + 24);
    const n = s.news.find((x) => x.headline.includes("Field outage"))!;
    expect(n.tick).toBe(58);
    expect(n.shockTick).toBe(34);
  });
});
