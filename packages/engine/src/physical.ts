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
import { priceParts, structure, ttfUsdMmbtu } from "./markets";
import { LNG } from "./refdata";
import { lngMarketAt, unitOfGrade } from "./world_data";
import { ckey } from "./liquidity";
import { ledger, closeLc, markEur } from "./finance";
import { COUNTERPARTIES } from "./world_data";
import { publishNews } from "./information";
import { GRADES, PORTS, QUALITY_GRID, SHIPPING, VESSEL_CLASSES, type Basis } from "./world_data";
import { expectedFreightUsd, etaTick, voyageVessel } from "./shipping";
import type { AttributionLeg, AttributionRow, Cargo, CargoLeg, EngineEvent, State, Tender, WindowSpec } from "./types";

const usd = (x: number) => (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString();
export const levelDayOf = (state: State, tick = state.tick): number => Math.floor(tick / HOURS_PER_DAY);

/** tau (months to expiry) of the front contract of `inst` now. */
function tauFront(state: State, inst: "BRENT" | "WTI" | "DUBAI" | "HH" | "TTF" | "JKM"): number {
  const c = state.contracts[ckey(inst, state.listed[inst][0])];
  return c ? Math.max(0, (c.expiryTick - state.tick) / HOURS_PER_DAY / 30.4375) : 0.5;
}

/** The attribution leg a named part of a price lands in. */
export const legOfPart = (k: string): AttributionLeg => (k === "flat" ? "flat" : k === "basis" ? "basis" : k === "fx" ? "fx" : k === "crack" ? "crack" : "time_spread");

/**
 * The named parts of the forward assessment of `basis` for level day `day`, from the factors now. Crude bases are $/bbl;
 * gas bases are $/MMBtu. TTF is quoted in EUR/MWh: its dollar value per MMBtu is TTF x EURUSD / 3.412, and the part of that
 * which is the move in EURUSD since the level began is a separate `fx` part, so a TTF-priced cargo shows an FX leg.
 */
export function basisParts(state: State, basis: Basis, day: number): Record<string, number> {
  const f = state.factors;
  const ahead = Math.max(0, day - levelDayOf(state)) / 30.4375;
  switch (basis) {
    case "DATED": return { flat: f.brentPrompt, time_spread: structure(f.spread1.BRENT, tauFront(state, "BRENT") + ahead), basis: f.datedDiff };
    case "BRENT": return { flat: f.brentPrompt, time_spread: structure(f.spread1.BRENT, tauFront(state, "BRENT") + ahead) };
    case "WTI": return { flat: f.brentPrompt, basis: -f.bw, time_spread: structure(f.spread1.WTI, tauFront(state, "WTI") + ahead) };
    case "DUBAI": return { flat: f.brentPrompt, basis: -f.dubaiEW, time_spread: structure(f.spread1.DUBAI, tauFront(state, "DUBAI") + ahead) };
    case "HH": return { flat: f.hhPrompt, time_spread: structure(f.spread1.HH, tauFront(state, "HH") + ahead) };
    case "TTF": {
      const fx0 = state.fx0 || f.eurusd;
      return { flat: ttfUsdMmbtu(f.ttfPrompt, fx0), fx: ttfUsdMmbtu(f.ttfPrompt, f.eurusd) - ttfUsdMmbtu(f.ttfPrompt, fx0), time_spread: ttfUsdMmbtu(structure(f.spread1.TTF, tauFront(state, "TTF") + ahead), f.eurusd) };
    }
    case "JKM": return { flat: ttfUsdMmbtu(f.ttfPrompt, f.eurusd), basis: f.jkmPremium, time_spread: structure(f.spread1.JKM, tauFront(state, "JKM") + ahead) };
  }
}
export const unitOf = (cargo: Cargo): "bbl" | "MMBtu" => unitOfGrade(cargo.grade);
export const sumParts = (p: Record<string, number>): number => Object.values(p).reduce((a, b) => a + b, 0);
export function basisPrice(state: State, basis: Basis, day: number): number { return sumParts(basisParts(state, basis, day)); }
export function assessmentNow(state: State, basis: Basis): number { return basisPrice(state, basis, levelDayOf(state)); }

/** The business days (level days) of a window anchored on `anchorDay`. */
export function windowDays(state: State, spec: WindowSpec, anchorDay: number): number[] {
  const abs = (d: number) => state.startDay + d;
  const out: number[] = [];
  if (spec.kind === "month_avg_bl" || spec.kind === "month_avg_offset") {
    const ym = ymOf(abs(anchorDay));
    const { year, month } = spec.kind === "month_avg_offset" ? addMonths(ym.year, ym.month, spec.offsetMonths ?? 1) : ym;
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
    case "month_avg_offset": return `average of the month ${spec.offsetMonths ?? 1} after the B/L month`;
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

/** The market an unsold cargo is marked against: its grade's benchmark, or for LNG the hub at its discharge terminal. */
export function expectedSaleBasis(cargo: Cargo): Basis {
  return cargo.grade === "LNG" ? lngMarketAt(cargo.dischargePort) : GRADES[cargo.grade].benchmark;
}
/** The expected sale of an unsold cargo: forward of its market at the expected discharge plus the market differential at the discharge port, by part. */
export function expectedSaleParts(state: State, cargo: Cargo): Record<string, number> {
  const dischargeDay = expectedDischargeDay(state, cargo);
  const days = windowDays(state, { kind: "after_discharge", days: 5 }, dischargeDay);
  const parts: Record<string, number> = {};
  for (const d of days) for (const [k, v] of Object.entries(basisParts(state, expectedSaleBasis(cargo), d))) parts[k] = (parts[k] ?? 0) + (v * cargo.bbl) / days.length;
  // LNG delivered at a terminal fetches the hub price less the regas fee and the buyer's margin: the netback, whatever the freight cost
  const diff = cargo.grade === "LNG" ? -(LNG.regasFee.value + LNG.buyerMargin.value) : state.factors.gradeDiffs[cargo.grade] + landedAdjustment(cargo);
  parts.basis = (parts.basis ?? 0) + cargo.bbl * diff;
  return parts;
}
/** A delivered price carries freight and insurance over FOB: the cargo's own expected (or fixed) freight per barrel plus insurance. */
export function landedAdjustment(cargo: Cargo): number {
  if (cargo.purchase.incoterm !== "FOB" || cargo.grade === "LNG") return 0;
  return (cargo.freight.fixedUsd ?? cargo.freight.expectedUsd) / cargo.bbl + SHIPPING.insurancePerBbl.value;
}

/** Net physical barrels as they will stand after today's window days print at the close. */
export function physicalExposureAfterPrintsBbl(state: State): number {
  const today = levelDayOf(state);
  let total = 0;
  for (const c of state.cargoes) {
    if (c.status === "cancelled") continue;
    const legExp = (leg: CargoLeg | null, sign: 1 | -1) => {
      if (!leg) return sign > 0 ? (c.tankId === null ? c.bbl : 0) : 0;
      const m = legMark(state, c, leg);
      const left = m.unpriced.filter((d) => !(leg.windowDays && d <= today)).length;
      return sign * c.bbl * (left / m.n);
    };
    total += legExp(c.purchase, -1) + legExp(c.sale, 1);
  }
  for (const t of state.tanks) for (const p of t.parcels) total += p.bbl;
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
  const cls = VESSEL_CLASSES[cargo.grade === "LNG" ? "LNGC" : (["AFRAMAX", "SUEZMAX", "VLCC"] as const).find((c) => VESSEL_CLASSES[c].cargoKb.value * 1000 >= cargo.bbl) ?? "VLCC"];
  const { shortestPath, blockedNodes, daysFor } = require_shipping();
  const p = shortestPath(PORTS[cargo.loadPort].node, PORTS[cargo.dischargePort].node, blockedNodes(state));
  return p ? daysFor(p.nm, cls.speedLaden) : 15;
}
// late binding to avoid a static import cycle in bundlers that dislike it; shipping does not import physical
import * as shippingMod from "./shipping";
function require_shipping() { return shippingMod; }

/** Unpaid extra costs of a cargo: demurrage, war risk, open or settled-but-unpaid claims, and LNG boil-off until the sale is invoiced net of it. */
export function extraCostsUsd(cargo: Cargo): { demurrage: number; warRisk: number; quality: number; boilOff: number } {
  return { demurrage: cargo.demurragePaidTick === null ? cargo.demurrageUsd : 0, warRisk: cargo.warRiskUsd, quality: cargo.claims.filter((c) => c.status === "open" || c.status === "settled" || c.status === "lost").reduce((a, c) => a + c.amountUsd, 0), boilOff: cargo.sale && cargo.sale.paidTick !== null ? 0 : cargo.boilOffUsd };
}

/** The whole mark of a cargo in USD, counting only what has not been paid or received yet. */
export function cargoMark(state: State, cargo: Cargo): { valueUsd: number; purchasePerBbl: number; salePerBbl: number | null; expectedSalePerBbl: number; freightUsd: number; extra: ReturnType<typeof extraCostsUsd> } {
  const p = legMark(state, cargo, cargo.purchase);
  const purchaseUsd = cargo.purchase.paidTick === null ? p.fixedUsd + sumParts(p.parts) - cargo.prepaidUsd : 0;
  let saleUsd: number;
  let salePerBbl: number | null = null;
  const exp = expectedSaleParts(state, cargo);
  if (cargo.sale) { const s = legMark(state, cargo, cargo.sale); salePerBbl = s.perBbl; saleUsd = cargo.sale.paidTick === null ? s.fixedUsd + sumParts(s.parts) : 0; }
  else saleUsd = cargo.status === "cancelled" || cargo.tankId !== null ? 0 : sumParts(exp);
  const freightUsd = cargo.freight.paidTick === null ? (cargo.freight.fixedUsd ?? cargo.freight.expectedUsd) : 0;
  const extra = extraCostsUsd(cargo);
  const valueUsd = cargo.status === "cancelled" ? 0 : saleUsd - purchaseUsd - freightUsd - extra.demurrage - extra.warRisk - extra.quality - extra.boilOff;
  return { valueUsd, purchasePerBbl: p.perBbl, salePerBbl, expectedSalePerBbl: sumParts(exp) / cargo.bbl, freightUsd, extra };
}

export function cargoesMarkUsd(state: State): number {
  return state.cargoes.reduce((a, c) => a + cargoMark(state, c).valueUsd, 0);
}

/**
 * Net flat-price exposure of the physical book: long on unpriced sales and unsold cargoes, short on unpriced purchases, in the
 * units of each leg's basis (barrels for crude, MMBtu for gas). `bbl` is the crude total (the figure the Brent hedge offsets);
 * `byBasis` splits every unit by the market it prices against, so a gas cargo's hedge is sized in the right contract.
 */
export function physicalExposureBbl(state: State): { bbl: number; byCargo: Record<string, number>; byBasis: Partial<Record<Basis, number>>; gas: number } {
  let total = 0;
  let gas = 0;
  const byCargo: Record<string, number> = {};
  const byBasis: Partial<Record<Basis, number>> = {};
  const add = (basis: Basis, units: number) => { byBasis[basis] = (byBasis[basis] ?? 0) + units; if (basis === "HH" || basis === "TTF" || basis === "JKM") gas += units; else total += units; };
  for (const c of state.cargoes) {
    if (c.status === "cancelled" || c.status === "delivered" && c.sale && c.sale.fixed !== null && c.purchase.fixed !== null) continue;
    const p = legMark(state, c, c.purchase);
    let e = -c.bbl * (p.unpriced.length / p.n);
    add(c.purchase.basis, e);
    if (c.sale) { const s = legMark(state, c, c.sale); const x = c.bbl * (s.unpriced.length / s.n); e += x; add(c.sale.basis, x); }
    else if (c.tankId === null) { e += c.bbl; add(expectedSaleBasis(c), c.bbl); }
    byCargo[c.id] = e;
  }
  // oil in a tank is owned outright: long until it is sold forward (the parcel leaves the tank's mark at the sale)
  for (const t of state.tanks) for (const p of t.parcels) { byCargo[p.cargoId ?? p.id] = (byCargo[p.cargoId ?? p.id] ?? 0) + p.bbl; add(p.benchmark, p.bbl); }
  return { bbl: total, byCargo, byBasis, gas };
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
    const legName = legOfPart(k);
    const share = prev.length / n;
    if (first) {
      const u = unitOf(cargo);
      rows.push({ tick: state.tick, inst: "BRENT", month: cargo.id, leg: legName, amount: delta, text: k === "basis" ? `${GRADES[cargo.grade].name} ${cargo.id} ${label}: contracted at ${leg.basis} ${leg.diff >= 0 ? "+" : ""}${leg.diff.toFixed(2)} on ${cargo.bbl.toLocaleString()} ${u}: the differential and the benchmark basis booked ${sign > 0 ? "as revenue" : "as cost"}.` : k === "flat" ? `${GRADES[cargo.grade].name} ${cargo.id} ${label}: the flat-price value of ${cargo.bbl.toLocaleString()} ${u} booked ${sign > 0 ? "as revenue" : "as cost"} at today's forward (${windowText(leg.window)}).` : k === "fx" ? `${GRADES[cargo.grade].name} ${cargo.id} ${label}: priced in euros (TTF): the dollar value of the EUR leg at today's EURUSD against the level's opening rate.` : `${GRADES[cargo.grade].name} ${cargo.id} ${label}: the curve's value at the ${windowText(leg.window)} window booked ${sign > 0 ? "as revenue" : "as cost"}.` });
      continue;
    }
    const text = k === "flat" ? `${GRADES[cargo.grade].name} ${cargo.id} ${label}: the flat price moved while ${Math.round(share * 100)}% of the ${windowText(leg.window)} window was unpriced (${sign > 0 ? "long" : "short"} ${Math.round(cargo.bbl * share).toLocaleString()} ${unitOf(cargo)} of exposure).`
      : k === "basis" ? `${GRADES[cargo.grade].name} ${cargo.id} ${label}: the ${leg.basis === "DATED" ? "Dated-to-futures" : leg.basis === "DUBAI" ? "Brent-Dubai" : leg.basis === "JKM" ? "JKM-over-TTF (Asian premium)" : "Brent-WTI"} basis moved on the unpriced part of the window.`
      : k === "fx" ? `${GRADES[cargo.grade].name} ${cargo.id} ${label}: EURUSD moved on the euro-priced (TTF) part of the window: the FX leg of a gas cargo sold in Europe.`
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
        rows.push({ tick: state.tick, inst: "BRENT", month: cargo.id, leg: legOfPart(k), amount: -v, text: `${name}: the market value the unsold cargo was marked at is replaced by the contract (${reason}); sold at ${cargo.sale.diff >= 0 ? "+" : ""}${cargo.sale.diff.toFixed(2)} over ${cargo.sale.basis}.` });
      }
      cargo.marketBase = {};
    }
  } else if (cargo.tankId === null) {
    const exp = expectedSaleParts(state, cargo);
    for (const k of new Set([...Object.keys(exp), ...Object.keys(cargo.marketBase)])) {
      const delta = (exp[k] ?? 0) - (cargo.marketBase[k] ?? 0);
      if (Math.abs(delta) < 0.005) continue;
      const legName = legOfPart(k);
      rows.push({ tick: state.tick, inst: "BRENT", month: cargo.id, leg: legName, amount: delta, text: k === "basis" ? (cargo.grade === "LNG" ? `${name} unsold: marked at ${expectedSaleBasis(cargo)} delivered ${PORTS[cargo.dischargePort].name} less the regas fee and the buyer's margin (the netback).` : `${name} unsold: the market differential for ${GRADES[cargo.grade].name} delivered ${PORTS[cargo.dischargePort].name} moved (now ${(state.factors.gradeDiffs[cargo.grade] + landedAdjustment(cargo)).toFixed(2)} over ${GRADES[cargo.grade].benchmark}).`) : k === "flat" ? `${name} unsold: the flat price moved on ${cargo.bbl.toLocaleString()} ${unitOf(cargo)} of unsold ${cargo.grade === "LNG" ? "gas" : "oil"}.` : k === "fx" ? `${name} unsold: EURUSD moved on the euro-priced market it is marked against.` : `${name} unsold: the curve at the expected sale window moved.` });
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
export function chargeCargo(state: State, cargo: Cargo, kind: "demurrage" | "freight" | "quality" | "boiloff", amountUsd: number, text: string): AttributionRow {
  if (kind === "demurrage") cargo.demurrageUsd += amountUsd;
  else if (kind === "freight") cargo.warRiskUsd += amountUsd;
  else if (kind === "boiloff") cargo.boilOffUsd += amountUsd;
  cargo.extraCostsBase += amountUsd;
  return { tick: state.tick, inst: "BRENT", month: cargo.id, leg: kind === "boiloff" ? "freight" : kind, amount: -amountUsd, text };
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
    if (cargo.status === "cancelled") continue;
    const name = `${GRADES[cargo.grade].name} ${cargo.id}`;
    for (const [label, leg, sign] of [["purchase", cargo.purchase, -1], ["sale", cargo.sale, 1]] as [string, CargoLeg | null, 1 | -1][]) {
      if (!leg || leg.paidTick !== null || leg.amountUsd === null || leg.dueTick === null || leg.dueTick > state.tick) continue;
      // a slow payer pays late, once, with a word
      const cp = COUNTERPARTIES[leg.counterparty];
      const cs = state.counterparties[leg.counterparty];
      if (sign > 0 && cp && cp.lateDays > 0 && cs && !(leg as CargoLeg & { lateFlagged?: boolean }).lateFlagged) {
        (leg as CargoLeg & { lateFlagged?: boolean }).lateFlagged = true;
        leg.dueTick = state.tick + cp.lateDays * HOURS_PER_DAY;
        cs.late += 1;
        publishNews(state, { source: "wire", headline: `${cp.name} is late paying ${usd(leg.amountUsd)} on ${name}`, body: `"Processing." Expect it in about ${cp.lateDays} days. Your line carries the gap and charges interest for it; their rating should carry it too.` });
        events.push({ kind: "credit", tick: state.tick, text: `${cp.name} is late on ${usd(leg.amountUsd)} for ${name}: about ${cp.lateDays} days.`, pause: true, data: { cargoId: cargo.id } });
        continue;
      }
      leg.paidTick = state.tick;
      const net = sign < 0 ? leg.amountUsd - cargo.prepaidUsd : leg.amountUsd - cargo.boilOffUsd;
      const u = unitOf(cargo);
      if (leg.basis === "TTF") {
        // a TTF-priced invoice is settled in euros at today's rate: the cash lands in the EUR account (revalued first, so the FX leg is exact)
        markEur(state);
        const eur = net / state.factors.eurusd;
        ledger(state, "other", sign * eur, `${sign > 0 ? "Received" : "Paid"} EUR ${Math.round(eur).toLocaleString()} (${usd(net)} at ${state.factors.eurusd.toFixed(4)}) for ${name} ${label} (${leg.fixed!.toFixed(3)} $/${u} x ${cargo.bbl.toLocaleString()} ${u}${sign > 0 && cargo.boilOffUsd > 0 ? `, less ${usd(cargo.boilOffUsd)} of boil-off` : ""})`, "EUR");
      } else ledger(state, "other", sign * net, `${sign > 0 ? "Received" : "Paid"} ${usd(net)} for ${name} ${label} (${leg.fixed!.toFixed(u === "bbl" ? 2 : 3)} $/${u} x ${cargo.bbl.toLocaleString()} ${u}${sign < 0 && cargo.prepaidUsd > 0 ? `, less ${usd(cargo.prepaidUsd)} prepaid` : ""}${sign > 0 && cargo.boilOffUsd > 0 ? `, less ${usd(cargo.boilOffUsd)} of boil-off` : ""})`);
      if (sign < 0) { closeLc(state, cargo); cargo.prepaidUsd = 0; }
      if (cs) cs.dealsWithPlayer += 1;
      events.push({ kind: "cargo", tick: state.tick, text: `${sign > 0 ? "Received" : "Paid"} ${usd(net)}: ${name} ${label} invoice.`, data: { cargoId: cargo.id } });
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
    requiresLc: t.requiresLc, lcId: null, prepaidUsd: 0, insured: false, tankId: null, parcelId: null, cancelled: null, regasBooked: false, boilOffUsd: 0,
  };
  cargo.freight.expectedUsd = isPipeline(cargo) ? 0 : expectedFreightUsd(state, cargo);
  return cargo;
}

/** A batch at an inland hub (Cushing) moves by pipeline: no ship, delivered on the laycan's first day. */
export function isPipeline(cargo: Cargo): boolean {
  return PORTS[cargo.loadPort].node === "";
}

/** Prepay a producer: the forward value of the cargo now, for a discount on the differential; trued up at the invoice. */
export function prepayCargo(state: State, cargo: Cargo, discountPerBbl: number): number {
  const m = legMark(state, cargo, cargo.purchase);
  const amount = m.perBbl * cargo.bbl;
  cargo.prepaidUsd = amount;
  cargo.purchase.diff -= discountPerBbl;
  return amount;
}

/** Cancel a cargo (a seller's default, a missing letter of credit): every leg comes off the mark; a sold-on cargo owes its receiver. */
export function cancelCargo(state: State, cargo: Cargo, by: string, reason: string, penaltyToReceiver: boolean): AttributionRow[] {
  const rows: AttributionRow[] = [];
  const name = `${GRADES[cargo.grade].name} ${cargo.id}`;
  const sign = (k: string): AttributionLeg => legOfPart(k);
  for (const [k, v] of Object.entries(cargo.purchase.base)) if (Math.abs(v) >= 0.005) rows.push({ tick: state.tick, inst: "BRENT", month: cargo.id, leg: sign(k), amount: v, text: `${name} cancelled (${reason}): the purchase comes off the mark.` });
  cargo.purchase.base = {};
  if (cargo.sale) {
    for (const [k, v] of Object.entries(cargo.sale.base)) if (Math.abs(v) >= 0.005) rows.push({ tick: state.tick, inst: "BRENT", month: cargo.id, leg: sign(k), amount: -v, text: `${name} cancelled: the onward sale to ${cargo.sale.counterparty} cannot be delivered and comes off the mark.` });
    cargo.sale.base = {};
    if (penaltyToReceiver) {
      const s = legMark(state, cargo, cargo.sale);
      const penalty = (0.5 + Math.max(0, s.perBbl - legMark(state, cargo, cargo.purchase).perBbl)) * cargo.bbl;
      rows.push({ tick: state.tick, inst: "BRENT", month: cargo.id, leg: "credit", amount: -penalty, text: `${name}: failed to deliver the onward sale; the receiver claims the market move plus a stylised $0.50/bbl.` });
      ledger(state, "other", -penalty, `Fail-to-deliver settlement on ${name}`);
    }
  }
  for (const [k, v] of Object.entries(cargo.marketBase)) if (Math.abs(v) >= 0.005) rows.push({ tick: state.tick, inst: "BRENT", month: cargo.id, leg: sign(k), amount: -v, text: `${name} cancelled: the unsold mark comes off.` });
  cargo.marketBase = {};
  const freightBase = cargo.freight.base;
  if (freightBase > 0 && cargo.freight.paidTick === null) {
    if (cargo.freight.fixedUsd !== null) {
      const fee = cargo.freight.fixedUsd * 0.15;
      rows.push({ tick: state.tick, inst: "BRENT", month: cargo.id, leg: "freight", amount: freightBase - fee, text: `${name} cancelled: the charter is cancelled; the owner keeps 15% of the lump sum (stylised).` });
      ledger(state, "other", -fee, `Charter cancellation fee on ${name}`);
      const v = state.voyages.find((x) => x.id === cargo.voyageId);
      const vessel = state.vessels.find((x) => x.id === cargo.vesselId);
      if (v) v.status = "done";
      if (vessel) { vessel.status = "available"; vessel.voyageId = null; }
    } else rows.push({ tick: state.tick, inst: "BRENT", month: cargo.id, leg: "freight", amount: freightBase, text: `${name} cancelled: no freight to pay.` });
    cargo.freight.base = 0;
  }
  if (cargo.prepaidUsd > 0) {
    rows.push({ tick: state.tick, inst: "BRENT", month: cargo.id, leg: "credit", amount: -cargo.prepaidUsd, text: `${name}: the prepayment of ${usd(cargo.prepaidUsd)} to ${by} is lost in the default.` });
  }
  if (cargo.insured) {
    const loss = -rows.filter((r) => r.leg === "credit").reduce((a, r) => a + r.amount, 0) - rows.filter((r) => r.leg !== "credit" && r.leg !== "freight").reduce((a, r) => a + r.amount, 0);
    if (loss > 0) {
      const recovery = loss * 0.9;
      rows.push({ tick: state.tick, inst: "BRENT", month: cargo.id, leg: "credit", amount: recovery, text: `${name}: the insurer pays 90% of the loss on the default: ${usd(recovery)}.` });
      ledger(state, "other", recovery, `Insurance recovery on ${name}`);
    }
  }
  cargo.status = "cancelled";
  cargo.cancelled = { tick: state.tick, by, reason };
  return rows;
}

/** Pipeline batches: delivered at the laycan's first day with no ship; a required letter of credit missing cancels the deal. */
export function stepPipelineCargoes(state: State): { events: EngineEvent[]; rows: AttributionRow[] } {
  const events: EngineEvent[] = [];
  const rows: AttributionRow[] = [];
  for (const cargo of state.cargoes) {
    if (!isPipeline(cargo) || cargo.status !== "contracted") continue;
    if (state.tick < cargo.laycan[0] * HOURS_PER_DAY + 9) continue;
    if (cargo.requiresLc && !cargo.lcId) {
      rows.push(...cancelCargo(state, cargo, cargo.purchase.counterparty, "no letter of credit by the transfer date", true));
      events.push({ kind: "cargo", tick: state.tick, text: `${GRADES[cargo.grade].name} ${cargo.id} cancelled: the seller wanted a letter of credit before transfer and none was opened.`, pause: true, data: { cargoId: cargo.id } });
      continue;
    }
    onBillOfLading(state, cargo);
    onDischarged(state, cargo);
    rows.push(...remarkCargo(state, cargo, "pipeline transfer"));
    events.push({ kind: "cargo", tick: state.tick, text: `${GRADES[cargo.grade].name} ${cargo.id}: ${cargo.bbl.toLocaleString()} bbl transferred at ${PORTS[cargo.loadPort].name}. The purchase prices over ${cargo.purchase.windowDays!.map((d) => `day ${d}`).join(", ")}. Store it in a tank or sell it.`, pause: true, data: { cargoId: cargo.id } });
  }
  return { events, rows };
}

export function cargoNotUsed(): void {
  void 0;
}

export function attachSale(state: State, cargo: Cargo, t: Tender): void {
  const anchor = cargo.dischargeTick !== null ? levelDayOf(state, cargo.dischargeTick) : expectedDischargeDay(state, cargo);
  cargo.sale = { counterparty: t.counterparty, basis: t.basis, window: t.window, diff: t.diff, incoterm: t.incoterm, port: t.port, windowDays: cargo.dischargeTick !== null && t.window.kind === "after_discharge" ? windowDays(state, t.window, anchor) : t.window.kind === "deemed" ? windowDays(state, t.window, anchor) : null, prints: {}, fixed: null, base: {}, unpricedDays: [], marked: false, expectedAnchorDay: anchor, amountUsd: null, dueTick: null, paidTick: null };
  if (cargo.blTick !== null && (t.window.kind === "month_avg_bl" || t.window.kind === "month_avg_offset" || t.window.kind === "after_bl")) { cargo.sale.windowDays = windowDays(state, t.window, levelDayOf(state, cargo.blTick)); cargo.sale.expectedAnchorDay = levelDayOf(state, cargo.blTick); }
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
  return `${GRADES[cargo.grade].name} ${cargo.bbl.toLocaleString()} ${unitOf(cargo)} ${cargo.purchase.incoterm} ${PORTS[cargo.loadPort].name} at ${cargo.purchase.basis} ${cargo.purchase.diff >= 0 ? "+" : ""}${cargo.purchase.diff.toFixed(2)} (${windowText(cargo.purchase.window)}); ${cargo.sale ? `sold ${cargo.sale.incoterm} ${PORTS[cargo.sale.port].name} at ${cargo.sale.basis} ${cargo.sale.diff >= 0 ? "+" : ""}${cargo.sale.diff.toFixed(2)} (${windowText(cargo.sale.window)})` : `unsold, marked at ${m.expectedSalePerBbl.toFixed(2)} delivered ${PORTS[cargo.dischargePort].name}`}; mark ${usd(m.valueUsd)}.`;
}

export const vesselForCargo = (state: State, cargo: Cargo) => state.vessels.find((v) => v.id === cargo.vesselId) ?? null;
export { voyageVessel };
