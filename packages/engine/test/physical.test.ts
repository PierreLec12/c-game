import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { makeRng } from "../src/rng";
import { applyActions, newGame, tick } from "../src/engine";
import { attributionTotals, unrealised } from "../src/pnl";
import { cargoesMarkUsd, windowDays, physicalExposureBbl, legMark } from "../src/physical";
import { charterQuotes, daysFor, greatCircleNm, NODE_BY_ID, shortestPath } from "../src/shipping";
import { PORTS, REFERENCE_VOYAGE_DAYS, SEA_EDGES, SEA_NODES } from "../src/world_data";
import { isSettleTick } from "../src/calendar";
import type { Action, State } from "../src/types";
import { testLevel } from "./helpers";

const P = "p1";

// ---------------------------------------------------------------- the map: routes stay off the land
type Ring = [number, number][];
const land: { features: { geometry: { coordinates: Ring[] } }[] } = JSON.parse(readFileSync(new URL("../../../apps/web/src/map/land.json", import.meta.url), "utf8"));
function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function onLand(lon: number, lat: number): boolean {
  for (const f of land.features) {
    const rings = f.geometry.coordinates;
    if (inRing(lon, lat, rings[0])) {
      for (let r = 1; r < rings.length; r++) if (inRing(lon, lat, rings[r])) return false;
      return true;
    }
  }
  return false;
}
const EXEMPT_PORT_KM = 110; // samples this close to a port are exempt: the 110m coastline has no harbours
const EXEMPT_STRAIT_KM = 200; // and no canals or narrow straits

describe("the sea graph", () => {
  it("has no route segment crossing the land polygon (away from ports and straits)", () => {
    const bad: string[] = [];
    for (const [a, b] of SEA_EDGES) {
      const na = NODE_BY_ID[a], nb = NODE_BY_ID[b];
      for (let k = 1; k < 16; k++) {
        const f = k / 16;
        let dLon = nb.lon - na.lon;
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        const lon = na.lon + f * dLon, lat = na.lat + f * (nb.lat - na.lat);
        const nearExempt = SEA_NODES.some((n) => n.kind !== "waypoint" && greatCircleNm(lon, lat, n.lon, n.lat) * 1.852 < (n.kind === "chokepoint" ? EXEMPT_STRAIT_KM : EXEMPT_PORT_KM));
        if (!nearExempt && onLand(lon, lat)) { bad.push(`${a}-${b} at ${lon.toFixed(1)},${lat.toFixed(1)}`); break; }
      }
    }
    expect(bad, bad.join("; ")).toEqual([]);
  });
  it("no port or waypoint node itself sits on land (ports may touch the coast)", () => {
    const bad = SEA_NODES.filter((n) => n.kind === "waypoint" && onLand(n.lon, n.lat)).map((n) => n.id);
    expect(bad, bad.join(", ")).toEqual([]);
  });
  it("voyage days are within a third of the prompt's stylised table", () => {
    const report: string[] = [];
    for (const r of REFERENCE_VOYAGE_DAYS) {
      const from = PORTS[r.from].node, to = PORTS[r.to].node;
      const blocked = new Set<string>(r.via === "CAPE" ? ["C_SUEZ", "C_BAB_EL_MANDEB"] : []);
      const p = shortestPath(from, to, blocked)!;
      expect(p, `${r.from} to ${r.to}`).not.toBeNull();
      const days = daysFor(p.nm, 12.5);
      report.push(`${r.from}->${r.to}${r.via ? ` via ${r.via}` : ""}: ${days.toFixed(1)}d (table ${r.days.value})`);
      expect(Math.abs(days - r.days.value) / r.days.value, report[report.length - 1]).toBeLessThan(0.34);
    }
  });
  it("closing Suez and Bab el-Mandeb sends a Gulf cargo round the Cape", () => {
    const open = shortestPath(PORTS.RAS_TANURA.node, PORTS.ROTTERDAM.node)!;
    const closed = shortestPath(PORTS.RAS_TANURA.node, PORTS.ROTTERDAM.node, new Set(["C_SUEZ"]))!;
    expect(open.path).toContain("C_SUEZ");
    expect(closed.path).toContain("C_CAPE");
    expect(closed.nm).toBeGreaterThan(open.nm * 1.3);
  });
});

// ---------------------------------------------------------------- windows
describe("pricing windows", () => {
  it("map to business days after the anchor, the B/L month, or a deemed day", () => {
    const spec = testLevel({ id: 960, days: 40, startDate: "2027-03-01" });
    const s = newGame(spec, 1, { par: 0 });
    expect(windowDays(s, { kind: "after_bl", days: 5 }, 3)).toEqual([4, 7, 8, 9, 10]); // Fri 5 Mar, then Mon-Thu
    expect(windowDays(s, { kind: "month_avg_bl" }, 10).length).toBe(23); // March 2027 business days
    expect(windowDays(s, { kind: "deemed", days: 3, deemedDay: 20 }, 4)).toEqual([21, 22, 23]);
  });
});

// ---------------------------------------------------------------- a cargo from tender to delivery
function cargoLevel(id: number, extra: Partial<Parameters<typeof testLevel>[0]> = {}) {
  return testLevel({
    id, days: 30, startDate: "2027-03-01", capital: 20e6, creditLine: 150e6, instruments: ["BRENT", "WTI", "DUBAI"],
    unlocks: ["order", "spread", "roll", "close", "cancel_order", "draw_line", "repay_line", "post_margin", "convert_fx", "open_card", "ask_mentor", "answer_drill", "answer_quiz", "end_level", "request_limit", "accept_tender", "decline_tender", "fix_charter", "instruct_ship", "efp", "settle_claim", "contest_claim"],
    limits: { var95: 50e6, netLots: { BRENT: 5000, WTI: 5000, RBOB: 5000, ULSD: 5000, HH: 5000, TTF: 5000, DUBAI: 5000 }, grossLots: 10000, stopLoss: 100e6, drawdown: 120e6, concentration: 1 },
    events: [
      { id: "offer", kind: "tender", day: 0, hour: 9, params: { counterparty: "NORTHSEA_MAJOR", side: "offer", grade: "FORTIES", incoterm: "FOB", port: "SULLOM_VOE", windowKind: "after_bl", windowDays: 5, laycanStart: 4, laycanDays: 2, openHours: 72 } },
      { id: "bid", kind: "tender", day: 0, hour: 10, params: { counterparty: "RHINE_REFINING", side: "bid", grade: "FORTIES", incoterm: "CIF", port: "ROTTERDAM", windowKind: "after_discharge", windowDays: 5, laycanStart: 8, laycanDays: 3, openHours: 96 } },
    ],
    ...extra,
  });
}

function runCargo(spec: ReturnType<typeof testLevel>, seed: number, extraActions: (s: State) => Action[] = () => []) {
  const rng = makeRng(seed);
  let s = newGame(spec, seed, { par: 0 });
  const checks: { tick: number; legs: number; total: number }[] = [];
  let etaAtDeparture: number | null = null;
  let arrivalTick: number | null = null;
  for (let t = 0; t < spec.days * 24 && s.level.status === "running"; t++) {
    const acts: Action[] = [];
    const offer = s.tenders.find((x) => x.side === "offer" && x.status === "open");
    const bid = s.tenders.find((x) => x.side === "bid" && x.status === "open");
    if (offer && s.cargoes.length === 0) acts.push({ type: "accept_tender", player: P, tenderId: offer.id });
    const cargo = s.cargoes[0];
    if (cargo && !cargo.vesselId) {
      const q = charterQuotes(s, cargo).find((x) => x.fits && x.etaLoadDay <= cargo.laycan[1]);
      if (q) acts.push({ type: "fix_charter", player: P, cargoId: cargo.id, vesselId: q.vesselId });
    }
    if (cargo && bid && !cargo.sale) acts.push({ type: "accept_tender", player: P, tenderId: bid.id, cargoId: cargo.id });
    acts.push(...extraActions(s));
    const r = tick(s, acts, rng);
    s = r.state;
    const v = s.voyages[0];
    if (v && v.status === "laden" && etaAtDeparture === null) etaAtDeparture = v.eta;
    for (const e of r.events) if (e.kind === "arrival" && e.text.includes("tendered notice") && arrivalTick === null) arrivalTick = e.tick;
    if (isSettleTick(s.startDay, s.tick)) {
      const legs = Object.values(attributionTotals(s.pnl.attribution)).reduce((a, b) => a + b, 0);
      checks.push({ tick: s.tick, legs, total: s.pnl.total });
    }
  }
  return { s, checks, etaAtDeparture, arrivalTick };
}

describe("a cargo", () => {
  it("goes from tender to delivery: fixed ship, bill of lading, windows printed, invoices paid, ship released", () => {
    const spec = cargoLevel(961);
    const { s, etaAtDeparture, arrivalTick } = runCargo(spec, 3);
    const c = s.cargoes[0];
    expect(c).toBeDefined();
    expect(c.status).toBe("delivered");
    expect(c.blTick).not.toBeNull();
    expect(c.purchase.windowDays!.length).toBe(5);
    expect(c.purchase.fixed).not.toBeNull();
    expect(c.sale!.fixed).not.toBeNull();
    expect(c.purchase.paidTick).not.toBeNull();
    expect(c.sale!.paidTick).not.toBeNull();
    expect(c.freight.paidTick).not.toBeNull();
    const vessel = s.vessels.find((v) => v.id === c.vesselId)!;
    expect(vessel.status).toBe("available");
    expect(vessel.atPort).toBe("ROTTERDAM");
    // the ship never arrives before the ETA it had when it sailed at full speed
    expect(arrivalTick).not.toBeNull();
    expect(arrivalTick!).toBeGreaterThanOrEqual(etaAtDeparture! - 1);
    // the ledger has the invoices and the freight
    expect(s.finance.ledger.some((r) => r.text.startsWith("Paid") && r.text.includes("purchase"))).toBe(true);
    expect(s.finance.ledger.some((r) => r.text.startsWith("Received") && r.text.includes("sale"))).toBe(true);
    expect(s.finance.ledger.some((r) => r.text.startsWith("Freight paid"))).toBe(true);
    const usd = s.finance.ledger.filter((r) => r.currency === "USD").reduce((a, r) => a + r.amount, 0);
    expect(Math.abs(usd - s.finance.cashUSD)).toBeLessThan(1e-6);
  });
  it("attribution legs sum to the book P&L to the cent at every settle, physical included", () => {
    const spec = cargoLevel(962);
    const { s, checks } = runCargo(spec, 5, (st) => {
      // a futures hedge against the cargo once it is laden
      const c = st.cargoes[0];
      if (c && c.status === "laden" && st.lots.length === 0) return [{ type: "order", player: P, inst: "BRENT", month: st.listed.BRENT[1], side: "sell", qty: Math.round(c.bbl / 1000), kind: "market", tag: "hedge" }];
      if (c && c.status === "delivered" && c.sale?.fixed !== null && st.lots.length > 0) return [{ type: "close", player: P, inst: "BRENT", month: st.listed.BRENT[1] }];
      return [];
    });
    expect(checks.length).toBeGreaterThan(10);
    for (const ch of checks) expect(Math.abs(ch.legs - ch.total), `tick ${ch.tick}: legs ${ch.legs.toFixed(2)} vs total ${ch.total.toFixed(2)}`).toBeLessThan(0.02);
    const tot = attributionTotals(s.pnl.attribution);
    expect(tot.freight).toBeLessThan(0);
    expect(Math.abs(tot.basis)).toBeGreaterThan(0);
    expect(s.pnl.attribution.some((r) => r.leg === "flat" && r.text.includes("unpriced"))).toBe(true);
    // after delivery and payment nothing is left on the mark
    expect(Math.abs(cargoesMarkUsd(s))).toBeLessThan(1);
    expect(Math.abs(unrealised(s))).toBeLessThan(1);
  });
  it("physical exposure is short on the unpriced purchase, long on the unpriced sale, and flat at inception", () => {
    const spec = cargoLevel(963);
    const rng = makeRng(2);
    let s = newGame(spec, 2, { par: 0 });
    s = tick(s, [], rng).state; s = tick(s, [], rng).state;
    s = tick(s, [], rng).state; s = tick(s, [], rng).state; s = tick(s, [], rng).state; s = tick(s, [], rng).state; s = tick(s, [], rng).state; s = tick(s, [], rng).state; s = tick(s, [], rng).state; s = tick(s, [], rng).state; s = tick(s, [], rng).state;
    const offer = s.tenders.find((x) => x.side === "offer")!;
    s = applyActions(s, [{ type: "accept_tender", player: P, tenderId: offer.id }], rng).state;
    expect(physicalExposureBbl(s).bbl).toBeCloseTo(0, 6); // unsold cargo: long the oil, short the unpriced purchase
    const c = s.cargoes[0];
    const m = legMark(s, c, c.purchase);
    expect(m.unpriced.length).toBe(5);
    expect(m.perBbl).toBeGreaterThan(50);
  });
  it("a congested port costs demurrage unless the ship slows down", () => {
    const base = cargoLevel(964, { events: [
      { id: "offer", kind: "tender", day: 0, hour: 9, params: { counterparty: "NORTHSEA_MAJOR", side: "offer", grade: "FORTIES", incoterm: "FOB", port: "SULLOM_VOE", windowKind: "after_bl", windowDays: 5, laycanStart: 3, laycanDays: 2, openHours: 72 } },
      { id: "bid", kind: "tender", day: 0, hour: 10, params: { counterparty: "RHINE_REFINING", side: "bid", grade: "FORTIES", incoterm: "CIF", port: "ROTTERDAM", windowKind: "after_discharge", windowDays: 5, laycanStart: 5, laycanDays: 4, openHours: 96 } },
      { id: "jam", kind: "port_congestion", day: 4, hour: 9, params: { port: "ROTTERDAM", hours: 96 } },
    ] });
    const fast = runCargo(base, 4);
    expect(fast.s.cargoes[0].demurrageUsd).toBeGreaterThan(0);
    expect(fast.s.pnl.attribution.some((r) => r.leg === "demurrage")).toBe(true);
    const slow = runCargo(cargoLevel(965, { events: base.events }), 4, (st) => {
      const c = st.cargoes[0];
      const v = st.voyages.find((x) => x.id === c?.voyageId);
      if (c && v && v.status === "laden" && v.speedFactor === 1 && st.news.some((n) => n.headline.includes("congested"))) return [{ type: "instruct_ship", player: P, cargoId: c.id, speedFactor: 0.7 }];
      return [];
    });
    expect(slow.s.cargoes[0].demurrageUsd).toBeLessThan(fast.s.cargoes[0].demurrageUsd);
  });
  it("a restricted passage holds the ship until an instruction; closing it reroutes automatically", () => {
    const spec = cargoLevel(966, { days: 50, events: [
      { id: "offer", kind: "tender", day: 0, hour: 9, params: { counterparty: "GULF_NATIONAL", side: "offer", grade: "ARAB_LIGHT", incoterm: "FOB", port: "RAS_TANURA", windowKind: "after_bl", windowDays: 5, laycanStart: 2, laycanDays: 2, openHours: 72 } },
      { id: "bid", kind: "tender", day: 0, hour: 10, params: { counterparty: "RHINE_REFINING", side: "bid", grade: "ARAB_LIGHT", incoterm: "CIF", port: "ROTTERDAM", basis: "DATED", windowKind: "after_discharge", windowDays: 5, laycanStart: 24, laycanDays: 6, openHours: 96 } },
      { id: "redsea", kind: "chokepoint", day: 6, hour: 9, params: { id: "BAB_EL_MANDEB", status: "restricted" } },
    ] });
    let decided = false;
    const r = runCargo(spec, 6, (st) => {
      const c = st.cargoes[0];
      const v = st.voyages.find((x) => x.id === c?.voyageId);
      if (c && v && v.status === "waiting_chokepoint" && !decided) { decided = true; return [{ type: "instruct_ship", player: P, cargoId: c.id, passage: "reroute" }]; }
      return [];
    });
    expect(decided).toBe(true);
    const v = r.s.voyages[0];
    expect(v.legs[1].path).toContain("C_CAPE");
    expect(r.s.pnl.attribution.some((x) => x.leg === "freight" && x.text.includes("detour"))).toBe(true);
    expect(r.s.cargoes[0].status).toBe("delivered");
    // closing: a fresh run where the passage closes instead
    const closed = cargoLevel(967, { days: 50, events: [...spec.events.slice(0, 2), { id: "redsea", kind: "chokepoint", day: 6, hour: 9, params: { id: "BAB_EL_MANDEB", status: "closed" } }] });
    const r2 = runCargo(closed, 6);
    expect(r2.s.voyages[0].detour).toContain("closed");
    expect(r2.s.voyages[0].legs[1].path).toContain("C_CAPE");
  });
  it("an EFP fixes the unpriced days and exchanges the paper at the mid", () => {
    const spec = cargoLevel(968);
    let done = false;
    const r = runCargo(spec, 7, (st) => {
      const c = st.cargoes[0];
      if (c && c.status === "laden" && st.lots.length === 0) return [{ type: "order", player: P, inst: "BRENT", month: st.listed.BRENT[0], side: "sell", qty: 600, kind: "market", tag: "hedge" }];
      if (c && st.lots.length > 0 && c.purchase.fixed === null && Object.keys(c.purchase.prints).length >= 1 && !done) { done = true; return [{ type: "efp", player: P, cargoId: c.id, leg: "purchase" }]; }
      return [];
    });
    expect(done).toBe(true);
    const c = r.s.cargoes[0];
    expect(c.purchase.fixed).not.toBeNull();
    expect(r.s.fills.some((f) => f.tag === "hedge" && f.side === "buy" && f.slippage === 0)).toBe(true);
  });
  it("a quality claim can be settled or contested", () => {
    const spec = cargoLevel(969, { events: [...cargoLevel(970).events, { id: "claim", kind: "quality_claim", day: 2, hour: 9, params: { usdPerBbl: 0.3 } }] });
    const r = runCargo(spec, 8, (st) => {
      const c = st.cargoes[0];
      const claim = c?.claims.find((k) => k.status === "open");
      if (c && claim) return [{ type: "settle_claim", player: P, cargoId: c.id, claimId: claim.id }];
      return [];
    });
    const c = r.s.cargoes[0];
    expect(c.claims.length).toBe(1);
    expect(c.claims[0].status).toBe("settled");
    expect(attributionTotals(r.s.pnl.attribution).quality).toBeLessThan(0);
    expect(r.s.finance.ledger.some((x) => x.text.includes("quality claim"))).toBe(true);
  });
});
