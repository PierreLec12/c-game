/**
 * Cargoes, pricing formulas and windows, Incoterms, laycans, nominations (section 4 and section 6), and the
 * lifecycle of a cargo from tender to delivery. A cargo leg's price is the average of its window's assessments plus
 * a differential; an unpriced day is marked at the forward assessment for that day, which is the curve, so the
 * mark decomposes into the same named parts as a future (flat, time spread, basis) and attribution stays exact.
 *
 * Pricing-window vocabulary (section 15): "5 days after B/L" = the five business days after the bill of lading;
 * "5 days after discharge" = the five business days after discharge completes; "month average" = every business
 * day of the calendar month of the B/L; "deemed B/L" = as "after B/L" but anchored on a stated day whatever the
 * ship does. A day's assessment is the model's value at that day's settle.
 */
import { HOURS_PER_DAY, dayOfTick, isBusinessDay, isoOfDay, ymOf, monthStart, addMonths } from "./calendar";
import { priceParts, structure } from "./markets";
import { ckey } from "./liquidity";
import { ledger } from "./finance";
import { publishNews } from "./information";
import { GRADES, PORTS, QUALITY_GRID, SHIPPING, VESSEL_CLASSES, type Basis } from "./world_data";
import { expectedFreightUsd, etaTick, voyageVessel } from "./shipping";
import type { AttributionRow, Cargo, CargoLeg, EngineEvent, State, Tender, WindowSpec } from "./types";

const usd = (x: number) => (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString();
export const levelDayOf = (state: State, tick = state.tick): number => Math.floor(tick / HOURS_PER_DAY);

/** tau (months to expiry) of the front Brent contract now. */
function tauFront(state: State, inst: "BRENT" | "WTI" | "DUBAI"): number {
  const c = state.contracts[ckey(inst, state.listed[inst][0])];
  return c ? Math.max(0, (c.expiryTick - state.tick) / HOURS_PER_DAY / 30.4375) : 0.5;
}

/** The named parts of the forward assessment of `basis` for level day `day`, from the factors now. */
export function basisParts(state: State, basis: Basis, day: number): Record<string, number> {
  const f = state.factors;
  const ahead = Math.max(0, day - levelDayOf(state)) / 30.4375;
  switch (basis) {
    case "DATED": return { flat: f.brentPrompt, time_spread: structure(f.spread1.BRENT, tauFront(state, "BRENT") + ahead), basis: f.datedDiff };
    case "BRENT": return { flat: f.brentPrompt, time_spread: structure(f.spread1.BRENT, tauFront(state, "BRENT") + ahead) };
    case "WTI": return { flat: f.brentPrompt, basis: -f.bw, time_spread: structure(f.spread1.WTI, tauFront(state, "WTI") + ahead) };
    case "DUBAI": return { flat: f.brentPrompt, basis: -f.dubaiEW, time_spread: structure(f.spread1.DUBAI, tauFront(state, "DUBAI") + ahead) };
  }
}
export const sumParts = (p: Record<string, number>): number => Object.values(p).reduce((a, b) => a + b, 0);
export function basisPrice(state: State, basis: Basis, day: number): number { return sumParts(basisParts(state, basis, day)); }
export function assessmentNow(state: State, basis: Basis): number { return basisPrice(state, basis, levelDayOf(state)); }

/** The business days (level days) of a window anchored on `anchorDay`. */
export function windowDays(state: State, spec: WindowSpec, anchorDay: number): number[] {
  const abs = (d: number) => state.startDay + d;
  const out: number[] = [];
  if (spec.kind === "month_avg_bl") {
    const { year, month } = ymOf(abs(anchorDay));
    const first = monthStart(year, month);
    const next = addMonths(year, month, 1);
    const end = monthStart(next.year, next.month);
    for (let d = first; d < end; d++) if (isBusinessDay(d)) out.push(d - state.startDay);
    return out;
  }
  const start = spec.kind === "deemed" ? (spec.deemedDay ?? anchorDay) : anchorDay;
  const n = spec.days ?? 5;
  let d = start + 1;
  while (out.length < n) { if (isBusinessDay(abs(d))) out.push(d); d += 1; }
  return out;
}

export function windowText(spec: WindowSpec): string {
  switch (spec.kind) {
    case "after_bl": return `${spec.days ?? 5} days after B/L`;
    case "after_discharge": return `${spec.days ?? 5} days after discharge`;
    case "month_avg_bl": return "month average of the B/L month";
    case "deemed": return `${spec.days ?? 5} days after a deemed B/L on day ${spec.deemedDay}`;
  }
}

/** Days of a leg's window: the real ones once anchored, else the expected ones. */
export function legDays(state: State, leg: CargoLeg): number[] {
  return leg.windowDays ?? windowDays(state, leg.window, leg.expectedAnchorDay);
}

/** USD by part over the unpriced days, the fixed USD, and the value per barrel of a leg. */
export function legMark(state: State, cargo: Cargo, leg: CargoLeg): { parts: Record<string, number>; fixedUsd: number; perBbl: number; unpriced: number[]; n: number } {
  const days = legDays(state, leg);
  const n = Math.max(1, days.length);
  const parts: Record<string, number> = {};
  let fixedSum = 0;
  const unpriced: number[] = [];
  for (const d of days) {
    const p = leg.prints[d];
    if (p !== undefined) { fixedSum += p; continue; }
    unpriced.push(d);
    const bp = basisParts(state, leg.basis, d);
    for (const [k, v] of Object.entries(bp)) parts[k] = (parts[k] ?? 0) + (v * cargo.bbl) / n;
  }
  const fixedUsd = cargo.bbl * (leg.diff + fixedSum / n);
  const perBbl = leg.diff + fixedSum / n + sumParts(parts) / cargo.bbl;
  return { parts, fixedUsd, perBbl, unpriced, n };
}

/** The expected sale of an unsold cargo: forward of its benchmark at the expected discharge plus the market differential at the discharge port, by part. */
export function expectedSaleParts(state: State, cargo: Cargo): Record<string, number> {
  const grade = GRADES[cargo.grade];
  const dischargeDay = expectedDischargeDay(state, cargo);
  const days = windowDays(state, { kind: "after_discharge", days: 5 }, dischargeDay);
  const parts: Record<string, number> = {};
  for (const d of days) for (const [k, v] of Object.entries(basisParts(state, grade.benchmark, d))) parts[k] = (parts[k] ?? 0) + (v * cargo.bbl) / days.length;
  parts.basis = (parts.basis ?? 0) + cargo.bbl * (state.factors.gradeDiffs[cargo.grade] + landedAdjustment(cargo));
  return parts;
}
/** A delivered price carries freight and insurance over FOB: the cargo's own expected (or fixed) freight per barrel plus insurance. */
export function landedAdjustment(cargo: Cargo): number {
  if (cargo.purchase.incoterm !== "FOB") return 0;
  return (cargo.freight.fixedUsd ?? cargo.freight.expectedUsd) / cargo.bbl + SHIPPING.insurancePerBbl.value;
}

/** Net physical barrels as they will stand after today's window days print at the close. */
export function physicalExposureAfterPrintsBbl(state: State): number {
  const today = levelDayOf(state);
  let total = 0;
  for (const c of state.cargoes) {
    if (c.status === "cancelled") continue;
    const legExp = (leg: CargoLeg | null, sign: 1 | -1) => {
      if (!leg) return sign > 0 ? c.bbl : 0;
      const m = legMark(state, c, leg);
      const left = m.unpriced.filter((d) => !(leg.windowDays && d <= today)).length;
      return sign * c.bbl * (left / m.n);
    };
    total += legExp(c.purchase, -1) + legExp(c.sale, 1);
  }
  return total;
}
export function expectedDischargeDay(state: State, cargo: Cargo): number {
  if (cargo.dischargeTick !== null) return levelDayOf(state, cargo.dischargeTick);
  const voyage = state.voyages.find((v) => v.id === cargo.voyageId);
  if (voyage) return levelDayOf(state, etaTick(state, voyage)) + 2;
  const laden = GRADES[cargo.grade];
  void laden;
  return cargo.laycan[1] + 2 + Math.round(estimateLadenDays(state, cargo)) + 2;
}
function estimateLadenDays(state: State, cargo: Cargo): number {
  const cls = VESSEL_CLASSES[(["AFRAMAX", "SUEZMAX", "VLCC"] as const).find((c) => VESSEL_CLASSES[c].cargoKb.value * 1000 >= cargo.bbl) ?? "VLCC"];
  const { shortestPath, blockedNodes, daysFor } = require_shipping();
  const p = shortestPath(PORTS[cargo.loadPort].node, PORTS[cargo.dischargePort].node, blockedNodes(state));
  return p ? daysFor(p.nm, cls.speedLaden) : 15;
}
// late binding to avoid a static import cycle in bundlers that dislike it; shipping does not import physical
import * as shippingMod from "./shipping";
function require_shipping() { return shippingMod; }

/** Unpaid extra costs of a cargo: demurrage, war risk, open or settled-but-unpaid claims. */
export function extraCostsUsd(cargo: Cargo): { demurrage: number; warRisk: number; quality: number } {
  return { demurrage: cargo.demurragePaidTick === null ? cargo.demurrageUsd : 0, warRisk: cargo.warRiskUsd, quality: cargo.claims.filter((c) => c.status === "open" || c.status === "settled" || c.status === "lost").reduce((a, c) => a + c.amountUsd, 0) };
}

/** The whole mark of a cargo in USD, counting only what has not been paid or received yet. */
export function cargoMark(state: State, cargo: Cargo): { valueUsd: number; purchasePerBbl: number; salePerBbl: number | null; expectedSalePerBbl: number; freightUsd: number; extra: ReturnType<typeof extraCostsUsd> } {
  const p = legMark(state, cargo, cargo.purchase);
  const purchaseUsd = cargo.purchase.paidTick === null ? p.fixedUsd + sumParts(p.parts) : 0;
  let saleUsd: number;
  let salePerBbl: number | null = null;
  const exp = expectedSaleParts(state, cargo);
  if (cargo.sale) { const s = legMark(state, cargo, cargo.sale); salePerBbl = s.perBbl; saleUsd = cargo.sale.paidTick === null ? s.fixedUsd + sumParts(s.parts) : 0; }
  else saleUsd = cargo.status === "cancelled" ? 0 : sumParts(exp);
  const freightUsd = cargo.freight.paidTick === null ? (cargo.freight.fixedUsd ?? cargo.freight.expectedUsd) : 0;
  const extra = extraCostsUsd(cargo);
  const valueUsd = cargo.status === "cancelled" ? 0 : saleUsd - purchaseUsd - freightUsd - extra.demurrage - extra.warRisk - extra.quality;
  return { valueUsd, purchasePerBbl: p.perBbl, salePerBbl, expectedSalePerBbl: sumParts(exp) / cargo.bbl, freightUsd, extra };
}

export function cargoesMarkUsd(state: State): number {
  return state.cargoes.reduce((a, c) => a + cargoMark(state, c).valueUsd, 0);
}

/** Net flat-price exposure of the physical book in barrels: long on unpriced sales and unsold cargoes, short on unpriced purchases. */
export function physicalExposureBbl(state: State): { bbl: number; byCargo: Record<string, number> } {
  let total = 0;
  const byCargo: Record<string, number> = {};
  for (const c of state.cargoes) {
    if (c.status === "cancelled" || c.status === "delivered" && c.sale && c.sale.fixed !== null && c.purchase.fixed !== null) continue;
    const p = legMark(state, c, c.purchase);
    let e = -c.bbl * (p.unpriced.length / p.n);
    if (c.sale) { const s = legMark(state, c, c.sale); e += c.bbl * (s.unpriced.length / s.n); }
    else e += c.bbl;
    byCargo[c.id] = e;
    total += e;
  }
  return { bbl: total, byCargo };
}

// ---------------------------------------------------------------- attribution: remark every cargo against its bases
/** The whole leg by part: printed days at their recorded parts, unpriced days at today's forward, plus the differential. The leg's mark is the sum. */
export function legPartsAll(state: State, cargo: Cargo, leg: CargoLeg): Record<string, number> {
  const days = legDays(state, leg);
  const n = Math.max(1, days.length);
  const parts: Record<string, number> = { basis: cargo.bbl * leg.diff };
  for (const d of days) {
    const bp = leg.prints[d] !== undefined ? printParts(state, leg, d) : basisParts(state, leg.basis, d);
    for (const [k, v] of Object.entries(bp)) parts[k] = (parts[k] ?? 0) + (v * cargo.bbl) / n;
  }
  return parts;
}

function legRows(state: State, cargo: Cargo, leg: CargoLeg, sign: 1 | -1, label: string): AttributionRow[] {
  const rows: AttributionRow[] = [];
  const n = Math.max(1, legDays(state, leg).length);
  const first = !leg.marked;
  const prev = first ? legMark(state, cargo, leg).unpriced : leg.unpricedDays;
  const now = legPartsAll(state, cargo, leg);
  for (const k of new Set([...Object.keys(now), ...Object.keys(leg.base)])) {
    const delta = ((now[k] ?? 0) - (leg.base[k] ?? 0)) * sign;
    if (Math.abs(delta) < 0.005) continue;
    const legName = k === "flat" ? "flat" : k === "basis" ? "basis" : "time_spread";
    const share = prev.length / n;
    if (first) {
      rows.push({ tick: state.tick, inst: "BRENT", month: cargo.id, leg: legName, amount: delta, text: k === "basis" ? `${GRADES[cargo.grade].name} ${cargo.id} ${label}: contracted at ${leg.basis} ${leg.diff >= 0 ? "+" : ""}${leg.diff.toFixed(2)} on ${cargo.bbl.toLocaleString()} bbl: the differential and the benchmark basis booked ${sign > 0 ? "as revenue" : "as cost"}.` : k === "flat" ? `${GRADES[cargo.grade].name} ${cargo.id} ${label}: the flat-price value of ${cargo.bbl.toLocaleString()} bbl booked ${sign > 0 ? "as revenue" : "as cost"} at today's forward (${windowText(leg.window)}).` : `${GRADES[cargo.grade].name} ${cargo.id} ${label}: the curve's value at the ${windowText(leg.window)} window booked ${sign > 0 ? "as revenue" : "as cost"}.` });
      continue;
    }
    const text = k === "flat" ? `${GRADES[cargo.grade].name} ${cargo.id} ${label}: the flat price moved while ${Math.round(share * 100)}% of the ${windowText(leg.window)} window was unpriced (${sign > 0 ? "long" : "short"} ${Math.round(cargo.bbl * share).toLocaleString()} bbl of exposure).`
      : k === "basis" ? `${GRADES[cargo.grade].name} ${cargo.id} ${label}: the ${leg.basis === "DATED" ? "Dated-to-futures" : leg.basis === "DUBAI" ? "Brent-Dubai" : "Brent-WTI"} basis moved on the unpriced part of the window.`
      : `${GRADES[cargo.grade].name} ${cargo.id} ${label}: the curve moved or a day passed: the forward value of the unpriced days changed (window timing is a time spread).`;
    rows.push({ tick: state.tick, inst: "BRENT", month: cargo.id, leg: legName, amount: delta, text });
  }
  return rows;
}
/** The parts of a day that has printed: the assessment is final, and its parts are the ones recorded at the print. */
function printParts(state: State, leg: CargoLeg, d: number): Record<string, number> {
  const rec = (leg as CargoLeg & { printParts?: Record<number, Record<string, number>> }).printParts?.[d];
  if (rec) return rec;
  return { flat: leg.prints[d] };
}

function rebaseLeg(state: State, cargo: Cargo, leg: CargoLeg): void {
  const m = legMark(state, cargo, leg);
  leg.base = legPartsAll(state, cargo, leg);
  leg.unpricedDays = m.unpriced;
  leg.marked = true;
}

/** Remark a cargo: rows for every part that moved since the last mark, then new bases. Called at every settle and after any structural change. */
export function remarkCargo(state: State, cargo: Cargo, reason: string): AttributionRow[] {
  if (cargo.status === "cancelled") return [];
  const rows: AttributionRow[] = [];
  const name = `${GRADES[cargo.grade].name} ${cargo.id}`;
  rows.push(...legRows(state, cargo, cargo.purchase, -1, "purchase"));
  rebaseLeg(state, cargo, cargo.purchase);
  if (cargo.sale) {
    rows.push(...legRows(state, cargo, cargo.sale, 1, "sale"));
    rebaseLeg(state, cargo, cargo.sale);
    if (Object.keys(cargo.marketBase).length) {
      // the expected sale the cargo was marked at is reversed: the contracted sale has just been booked in full
      for (const [k, v] of Object.entries(cargo.marketBase)) {
        if (Math.abs(v) < 0.005) continue;
        rows.push({ tick: state.tick, inst: "BRENT", month: cargo.id, leg: k === "flat" ? "flat" : k === "basis" ? "basis" : "time_spread", amount: -v, text: `${name}: the market value the unsold cargo was marked at is replaced by the contract (${reason}); sold at ${cargo.sale.diff >= 0 ? "+" : ""}${cargo.sale.diff.toFixed(2)} over ${cargo.sale.basis}.` });
      }
      cargo.marketBase = {};
    }
  } else {
    const exp = expectedSaleParts(state, cargo);
    for (const k of new Set([...Object.keys(exp), ...Object.keys(cargo.marketBase)])) {
      const delta = (exp[k] ?? 0) - (cargo.marketBase[k] ?? 0);
      if (Math.abs(delta) < 0.005) continue;
      const legName = k === "flat" ? "flat" : k === "basis" ? "basis" : "time_spread";
      rows.push({ tick: state.tick, inst: "BRENT", month: cargo.id, leg: legName, amount: delta, text: k === "basis" ? `${name} unsold: the market differential for ${GRADES[cargo.grade].name} delivered ${PORTS[cargo.dischargePort].name} moved (now ${(state.factors.gradeDiffs[cargo.grade] + landedAdjustment(cargo)).toFixed(2)} over ${GRADES[cargo.grade].benchmark}).` : k === "flat" ? `${name} unsold: the flat price moved on ${cargo.bbl.toLocaleString()} bbl of unsold oil.` : `${name} unsold: the curve at the expected sale window moved.` });
    }
    cargo.marketBase = exp;
  }
  // freight: expected until fixed, then constant; paid at discharge
  const freightNow = cargo.freight.paidTick === null ? (cargo.freight.fixedUsd ?? cargo.freight.expectedUsd) : cargo.freight.fixedUsd ?? cargo.freight.expectedUsd;
  const fDelta = -(freightNow - cargo.freight.base);
  if (Math.abs(fDelta) >= 0.005) rows.push({ tick: state.tick, inst: "BRENT", month: cargo.id, leg: "freight", amount: fDelta, text: cargo.freight.fixedUsd !== null ? `${name}: freight fixed at ${usd(cargo.freight.fixedUsd)} (${(cargo.freight.fixedUsd / cargo.bbl).toFixed(2)}/bbl) against ${usd(cargo.freight.base)} expected (${reason}).` : `${name}: the freight market moved: expected voyage cost now ${usd(freightNow)}.` });
  cargo.freight.base = freightNow;
  return rows;
}

/** Book a demurrage or war-risk or claim charge: a row and the cargo's cost. */
export function chargeCargo(state: State, cargo: Cargo, kind: "demurrage" | "freight" | "quality", amountUsd: number, text: string): AttributionRow {
  if (kind === "demurrage") cargo.demurrageUsd += amountUsd;
  else if (kind === "freight") cargo.warRiskUsd += amountUsd;
  cargo.extraCostsBase += amountUsd;
  return { tick: state.tick, inst: "BRENT", month: cargo.id, leg: kind, amount: -amountUsd, text };
}

// ---------------------------------------------------------------- prints and payments at the settle
export function settlePhysical(state: State): { rows: AttributionRow[]; events: EngineEvent[] } {
  const rows: AttributionRow[] = [];
  const events: EngineEvent[] = [];
  const today = levelDayOf(state);
  for (const cargo of state.cargoes) {
    if (cargo.status === "cancelled") continue;
    for (const [label, leg] of [["purchase", cargo.purchase], ["sale", cargo.sale]] as [string, CargoLeg | null][]) {
      if (!leg || !leg.windowDays) continue;
      if (leg.windowDays.includes(today) && leg.prints[today] === undefined) {
        const parts = basisParts(state, leg.basis, today);
        leg.prints[today] = sumParts(parts);
        ((leg as CargoLeg & { printParts?: Record<number, Record<string, number>> }).printParts ??= {})[today] = parts;
        const printed = Object.keys(leg.prints).length;
        if (printed === leg.windowDays.length) {
          const avg = leg.windowDays.reduce((a, d) => a + leg.prints[d], 0) / leg.windowDays.length;
          leg.fixed = avg + leg.diff;
          leg.amountUsd = leg.fixed * cargo.bbl;
          leg.dueTick = state.tick + SHIPPING.paymentDaysAfterWindow.value * HOURS_PER_DAY;
          events.push({ kind: "cargo", tick: state.tick, text: `${GRADES[cargo.grade].name} ${cargo.id} ${label} priced: ${leg.basis} average ${avg.toFixed(2)} ${leg.diff >= 0 ? "+" : ""}${leg.diff.toFixed(2)} = ${leg.fixed.toFixed(2)} $/bbl, ${usd(leg.amountUsd)} due ${isoOfDay(dayOfTick(state.startDay, leg.dueTick))}.`, data: { cargoId: cargo.id, leg: label }, pause: true });
        } else events.push({ kind: "cargo", tick: state.tick, text: `${GRADES[cargo.grade].name} ${cargo.id} ${label}: day ${printed} of ${leg.windowDays.length} printed at ${leg.prints[today].toFixed(2)}.`, data: { cargoId: cargo.id, leg: label } });
      }
    }
    rows.push(...remarkCargo(state, cargo, "settle"));
  }
  return { rows, events };
}

/** Pay what is due: invoices, freight, demurrage, settled claims. Cash moves; the mark drops by the same amount. */
export function payDues(state: State): EngineEvent[] {
  const events: EngineEvent[] = [];
  for (const cargo of state.cargoes) {
    const name = `${GRADES[cargo.grade].name} ${cargo.id}`;
    for (const [label, leg, sign] of [["purchase", cargo.purchase, -1], ["sale", cargo.sale, 1]] as [string, CargoLeg | null, 1 | -1][]) {
      if (!leg || leg.paidTick !== null || leg.amountUsd === null || leg.dueTick === null || leg.dueTick > state.tick) continue;
      leg.paidTick = state.tick;
      ledger(state, "other", sign * leg.amountUsd, `${sign > 0 ? "Received" : "Paid"} ${usd(leg.amountUsd)} for ${name} ${label} (${leg.fixed!.toFixed(2)} $/bbl x ${cargo.bbl.toLocaleString()} bbl)`);
      events.push({ kind: "cargo", tick: state.tick, text: `${sign > 0 ? "Received" : "Paid"} ${usd(leg.amountUsd)}: ${name} ${label} invoice.`, data: { cargoId: cargo.id } });
    }
    for (const claim of cargo.claims) {
      if ((claim.status === "settled" || claim.status === "lost") && claim.resolvedTick !== undefined && claim.resolvedTick <= state.tick && !(claim as Claim & { paid?: boolean }).paid) {
        (claim as Claim & { paid?: boolean }).paid = true;
        ledger(state, "other", -claim.amountUsd, `Paid ${usd(claim.amountUsd)} on a ${claim.kind} claim from ${claim.from} on ${name}`);
      }
    }
  }
  return events;
}
type Claim = Cargo["claims"][number];

// ---------------------------------------------------------------- creating cargoes from tenders
export function cargoFromOffer(state: State, t: Tender): Cargo {
  const grade = GRADES[t.grade];
  const id = `C${++state.counters.cargo}`;
  const dischargePort = grade.naturalMarket;
  const expectedBl = t.laycan[0] + 1;
  const purchase: CargoLeg = { counterparty: t.counterparty, basis: t.basis, window: t.window, diff: t.diff, incoterm: t.incoterm, port: t.port, windowDays: null, prints: {}, fixed: null, base: {}, unpricedDays: [], marked: false, expectedAnchorDay: expectedBl, amountUsd: null, dueTick: null, paidTick: null };
  const cargo: Cargo = {
    id, tenderId: t.id, grade: t.grade, bbl: t.bbl, purchase, sale: null, status: "contracted", loadPort: t.port, dischargePort, laycan: t.laycan, dischargeWindow: null,
    vesselId: null, voyageId: null, blTick: null, dischargeTick: null, quality: { api: grade.api, sulphur: grade.sulphur }, claims: [],
    freight: { expectedUsd: 0, fixedUsd: null, paidTick: null, base: 0 }, demurrageUsd: 0, demurragePaidTick: null, warRiskUsd: 0, extraCostsBase: 0, marketBase: {}, createdTick: state.tick,
  };
  cargo.freight.expectedUsd = expectedFreightUsd(state, cargo);
  return cargo;
}

export function attachSale(state: State, cargo: Cargo, t: Tender): void {
  const anchor = cargo.dischargeTick !== null ? levelDayOf(state, cargo.dischargeTick) : expectedDischargeDay(state, cargo);
  cargo.sale = { counterparty: t.counterparty, basis: t.basis, window: t.window, diff: t.diff, incoterm: t.incoterm, port: t.port, windowDays: cargo.dischargeTick !== null && t.window.kind === "after_discharge" ? windowDays(state, t.window, anchor) : t.window.kind === "deemed" ? windowDays(state, t.window, anchor) : null, prints: {}, fixed: null, base: {}, unpricedDays: [], marked: false, expectedAnchorDay: anchor, amountUsd: null, dueTick: null, paidTick: null };
  cargo.dischargeWindow = t.laycan;
  if (cargo.dischargePort !== t.port) cargo.dischargePort = t.port;
}

/** Called when the bill of lading is signed: the purchase window anchors on the B/L day. */
export function onBillOfLading(state: State, cargo: Cargo): void {
  cargo.blTick = state.tick;
  const blDay = levelDayOf(state);
  cargo.purchase.windowDays = windowDays(state, cargo.purchase.window, blDay);
  cargo.purchase.expectedAnchorDay = blDay;
  if (cargo.sale && (cargo.sale.window.kind === "after_bl" || cargo.sale.window.kind === "month_avg_bl")) { cargo.sale.windowDays = windowDays(state, cargo.sale.window, blDay); cargo.sale.expectedAnchorDay = blDay; }
  cargo.status = "laden";
}
export function onDischarged(state: State, cargo: Cargo): void {
  cargo.dischargeTick = state.tick;
  const d = levelDayOf(state);
  if (cargo.sale && cargo.sale.window.kind === "after_discharge") { cargo.sale.windowDays = windowDays(state, cargo.sale.window, d); cargo.sale.expectedAnchorDay = d; }
  cargo.status = "delivered";
}

/** EFP: fix the unpriced remainder of a leg at today's assessment, exchanging paper for the physical price. */
export function efpFix(state: State, cargo: Cargo, which: "purchase" | "sale"): { fixedBbl: number; price: number } | null {
  const leg = which === "purchase" ? cargo.purchase : cargo.sale;
  if (!leg) return null;
  const days = legDays(state, leg);
  if (!leg.windowDays) { leg.windowDays = days; }
  const today = levelDayOf(state);
  const price = assessmentNow(state, leg.basis);
  const parts = basisParts(state, leg.basis, today);
  let fixedDays = 0;
  for (const d of leg.windowDays) if (leg.prints[d] === undefined) { leg.prints[d] = price; ((leg as CargoLeg & { printParts?: Record<number, Record<string, number>> }).printParts ??= {})[d] = parts; fixedDays += 1; }
  const n = leg.windowDays.length;
  const avg = leg.windowDays.reduce((a, d) => a + leg.prints[d], 0) / n;
  leg.fixed = avg + leg.diff;
  leg.amountUsd = leg.fixed * cargo.bbl;
  leg.dueTick = Math.max(leg.dueTick ?? 0, state.tick + SHIPPING.paymentDaysAfterWindow.value * HOURS_PER_DAY);
  return { fixedBbl: (cargo.bbl * fixedDays) / n, price };
}

/** A quality claim from the inspector at discharge. */
export function raiseQualityClaim(state: State, cargo: Cargo, usdPerBbl: number, text: string): Claim {
  const claim: Claim = { id: `K${++state.counters.claim}`, tick: state.tick, kind: "quality", from: "VERITAS", amountUsd: usdPerBbl * cargo.bbl, text, status: "open" };
  cargo.claims.push(claim);
  publishNews(state, { source: "wire", headline: `Inspector: ${GRADES[cargo.grade].name} ${cargo.id} off-spec at discharge`, body: `${text} Claim ${usd(claim.amountUsd)} (${usdPerBbl.toFixed(2)} $/bbl at the stylised grid rate of ${QUALITY_GRID.claimUsdPerBbl.value}). Settle it, or contest it and let the inspector re-test.` });
  return claim;
}

export function cargoSummary(state: State, cargo: Cargo): string {
  const m = cargoMark(state, cargo);
  return `${GRADES[cargo.grade].name} ${cargo.bbl.toLocaleString()} bbl ${cargo.purchase.incoterm} ${PORTS[cargo.loadPort].name} at ${cargo.purchase.basis} ${cargo.purchase.diff >= 0 ? "+" : ""}${cargo.purchase.diff.toFixed(2)} (${windowText(cargo.purchase.window)}); ${cargo.sale ? `sold ${cargo.sale.incoterm} ${PORTS[cargo.sale.port].name} at ${cargo.sale.basis} ${cargo.sale.diff >= 0 ? "+" : ""}${cargo.sale.diff.toFixed(2)} (${windowText(cargo.sale.window)})` : `unsold, marked at ${m.expectedSalePerBbl.toFixed(2)} delivered ${PORTS[cargo.dischargePort].name}`}; mark ${usd(m.valueUsd)}.`;
}

export const vesselForCargo = (state: State, cargo: Cargo) => state.vessels.find((v) => v.id === cargo.vesselId) ?? null;
export { voyageVessel };
