/**
 * Tanks: leases, fill, cost of carry, blending (section 4 and section 6). A tank at a port holds parcels; a parcel is
 * marked at the local benchmark forward plus the grade's differential (the quality grid for a blend). Storage cost is a
 * monthly charge per barrel of leased capacity, in EUR at Rotterdam, and lands in the storage leg.
 */
import { HOURS_PER_DAY } from "./calendar";
import { ledger, markEur } from "./finance";
import { GRADES, PORTS, QUALITY_GRID, STORAGE_TANKS, type Basis, type Grade } from "./world_data";
import { basisParts, levelDayOf } from "./physical";
import type { AttributionRow, Cargo, Parcel, State, Tank } from "./types";

const usd = (x: number) => (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString();
export const MONTH_HOURS = 30.4375 * HOURS_PER_DAY;

export function leaseTank(state: State, port: string, bbl: number, months: number): Tank {
  const spec = STORAGE_TANKS[port];
  const tank: Tank = { id: `K${++state.counters.tank}`, port, capacityBbl: bbl, costPerBblMonth: spec.costPerBblMonth.value, currency: spec.currency, leasedTick: state.tick, months, nextChargeTick: state.tick, chargesPaid: 0, fillRateBblPerDay: spec.fillRateBblPerDay.value, parcels: [], released: false };
  state.tanks.push(tank);
  return tank;
}

/** Monthly charges fall due on the lease anniversary; the first at signing. Returns attribution rows. */
export function chargeTanks(state: State): AttributionRow[] {
  const rows: AttributionRow[] = [];
  for (const t of state.tanks) {
    if (t.released) continue;
    while (t.nextChargeTick <= state.tick) {
      const amount = t.capacityBbl * t.costPerBblMonth;
      if (t.currency === "EUR") markEur(state);
      const usdAmount = t.currency === "EUR" ? amount * state.factors.eurusd : amount;
      ledger(state, "other", -amount, `Tank ${t.id} at ${PORTS[t.port].name}: month ${t.chargesPaid + 1} of ${t.months} at ${t.costPerBblMonth.toFixed(2)} ${t.currency}/bbl on ${t.capacityBbl.toLocaleString()} bbl`, t.currency);
      t.chargesPaid += 1;
      t.nextChargeTick += MONTH_HOURS;
      rows.push({ tick: state.tick, inst: "WTI", month: t.id, leg: "storage", amount: -usdAmount, text: `Tank ${t.id} at ${PORTS[t.port].name}: a month's lease on ${t.capacityBbl.toLocaleString()} bbl at ${t.costPerBblMonth.toFixed(2)} ${t.currency} a barrel (stylised).` });
    }
  }
  return rows;
}

/** The benchmark a parcel at this port is marked against. */
export function benchmarkAt(port: string, grade: Grade | "BLEND"): Basis {
  if (port === "CUSHING" || port === "HOUSTON" || port === "ST_JAMES") return "WTI";
  if (port === "FUJAIRAH" || port === "SINGAPORE") return "DUBAI";
  if (grade !== "BLEND") return GRADES[grade].benchmark;
  return "DATED";
}

/** Differential of a parcel over its benchmark: the grade's market differential, or the quality grid for a blend. */
export function parcelDiff(state: State, p: Parcel): number {
  if (p.grade !== "BLEND") return state.factors.gradeDiffs[p.grade];
  // a blend prices on the grid around a 38 API, 0.5% sulphur reference, less a blend discount
  return QUALITY_GRID.usdPerApi.value * (p.api - 38) - QUALITY_GRID.usdPerSulphurPct.value * (p.sulphur - 0.5) - 0.15;
}

/** USD by part of a parcel's mark: the local benchmark at today's forward plus the differential. */
export function parcelParts(state: State, p: Parcel): Record<string, number> {
  const parts: Record<string, number> = {};
  for (const [k, v] of Object.entries(basisParts(state, p.benchmark, levelDayOf(state)))) parts[k] = v * p.bbl;
  parts.basis = (parts.basis ?? 0) + parcelDiff(state, p) * p.bbl;
  return parts;
}
export function parcelMarkUsd(state: State, p: Parcel): number {
  return Object.values(parcelParts(state, p)).reduce((a, b) => a + b, 0);
}
export function tanksMarkUsd(state: State): number {
  return state.tanks.reduce((a, t) => a + t.parcels.reduce((b, p) => b + parcelMarkUsd(state, p), 0), 0);
}
export function tankInventory(t: Tank): number { return t.parcels.reduce((a, p) => a + p.bbl, 0); }

/** Remark every parcel against its base: rows for every part that moved. */
export function remarkTanks(state: State): AttributionRow[] {
  const rows: AttributionRow[] = [];
  for (const t of state.tanks) for (const p of t.parcels) {
    const now = parcelParts(state, p);
    for (const k of new Set([...Object.keys(now), ...Object.keys(p.base)])) {
      const delta = (now[k] ?? 0) - (p.base[k] ?? 0);
      if (Math.abs(delta) < 0.005) continue;
      rows.push({ tick: state.tick, inst: "WTI", month: t.id, leg: k === "flat" ? "flat" : k === "basis" ? "basis" : "time_spread", amount: delta, text: k === "flat" ? `${p.label} in tank ${t.id}: the flat price moved on ${p.bbl.toLocaleString()} bbl of stored oil.` : k === "basis" ? `${p.label} in tank ${t.id}: the differential at ${PORTS[t.port].name} moved.` : `${p.label} in tank ${t.id}: the prompt structure moved; stored oil is marked at today's prompt.` });
    }
    p.base = now;
  }
  return rows;
}

/** Move a delivered cargo into a tank at its discharge port. The oil is marked at the prompt from here. */
export function storeCargo(state: State, cargo: Cargo, tank: Tank): { parcel: Parcel; rows: AttributionRow[] } {
  const grade = GRADES[cargo.grade];
  const parcel: Parcel = { id: `P${++state.counters.parcel}`, grade: cargo.grade, label: grade.name, bbl: cargo.bbl, api: cargo.quality.api, sulphur: cargo.quality.sulphur, costPerBbl: cargo.purchase.fixed ?? 0, cargoId: cargo.id, benchmark: benchmarkAt(tank.port, cargo.grade), base: {} };
  tank.parcels.push(parcel);
  cargo.tankId = tank.id; cargo.parcelId = parcel.id;
  // the cargo's expected-sale mark is replaced by the parcel's mark
  const rows: AttributionRow[] = [];
  for (const [k, v] of Object.entries(cargo.marketBase)) if (Math.abs(v) >= 0.005) rows.push({ tick: state.tick, inst: "WTI", month: cargo.id, leg: k === "flat" ? "flat" : k === "basis" ? "basis" : "time_spread", amount: -v, text: `${grade.name} ${cargo.id} into tank ${tank.id}: the delivered-sale mark is replaced by the stored parcel's mark.` });
  cargo.marketBase = {};
  const now = parcelParts(state, parcel);
  for (const [k, v] of Object.entries(now)) if (Math.abs(v) >= 0.005) rows.push({ tick: state.tick, inst: "WTI", month: tank.id, leg: k === "flat" ? "flat" : k === "basis" ? "basis" : "time_spread", amount: v, text: `${grade.name} ${cargo.bbl.toLocaleString()} bbl stored in tank ${tank.id} at ${PORTS[tank.port].name}, marked at the ${parcel.benchmark} prompt plus the differential.` });
  parcel.base = now;
  return { parcel, rows };
}

/** Rows that bring one parcel's base up to its live mark. */
function remarkParcel(state: State, tank: Tank, p: Parcel): AttributionRow[] {
  const rows: AttributionRow[] = [];
  const now = parcelParts(state, p);
  for (const k of new Set([...Object.keys(now), ...Object.keys(p.base)])) {
    const delta = (now[k] ?? 0) - (p.base[k] ?? 0);
    if (Math.abs(delta) < 0.005) continue;
    rows.push({ tick: state.tick, inst: "WTI", month: tank.id, leg: k === "flat" ? "flat" : k === "basis" ? "basis" : "time_spread", amount: delta, text: `${p.label} in tank ${t(tank)}: marked to today's prompt before it moves.` });
  }
  p.base = now;
  return rows;
}
const t = (tank: Tank) => tank.id;

/** Blend parcels in a tank into one, by volume-weighted API and sulphur. */
export function blendParcels(state: State, tank: Tank, ids: string[]): { parcel: Parcel; rows: AttributionRow[] } {
  const chosen = tank.parcels.filter((p) => ids.includes(p.id));
  const pre: AttributionRow[] = [];
  for (const p of chosen) pre.push(...remarkParcel(state, tank, p));
  const bbl = chosen.reduce((a, p) => a + p.bbl, 0);
  const api = chosen.reduce((a, p) => a + p.api * p.bbl, 0) / bbl;
  const sulphur = chosen.reduce((a, p) => a + p.sulphur * p.bbl, 0) / bbl;
  const cost = chosen.reduce((a, p) => a + p.costPerBbl * p.bbl, 0) / bbl;
  const before = chosen.reduce((a, p) => a + parcelMarkUsd(state, p), 0);
  const parcel: Parcel = { id: `P${++state.counters.parcel}`, grade: "BLEND", label: `Blend ${api.toFixed(1)} API ${sulphur.toFixed(2)}% S`, bbl, api, sulphur, costPerBbl: cost, cargoId: null, benchmark: benchmarkAt(tank.port, "BLEND"), base: {} };
  tank.parcels = [...tank.parcels.filter((p) => !ids.includes(p.id)), parcel];
  for (const c of state.cargoes) if (c.parcelId && ids.includes(c.parcelId)) c.parcelId = parcel.id;
  const after = parcelMarkUsd(state, parcel);
  parcel.base = parcelParts(state, parcel);
  const rows: AttributionRow[] = [...pre, { tick: state.tick, inst: "WTI", month: tank.id, leg: "basis", amount: after - before, text: `Blended ${chosen.map((p) => p.label).join(" and ")} into ${parcel.label}: the blend prices on the quality grid at ${parcelDiff(state, parcel).toFixed(2)} over ${parcel.benchmark}, against ${usd(before)} of parcels: ${usd(after - before)}.` }];
  return { parcel, rows };
}

/** Sell a parcel out of a tank into a cargo sale: the parcel leaves and the sale leg carries the barrels from here. */
export function drawParcel(state: State, tank: Tank, parcelId: string, bbl: number): { rows: AttributionRow[]; taken: number } {
  const p = tank.parcels.find((x) => x.id === parcelId);
  if (!p) return { rows: [], taken: 0 };
  const taken = Math.min(bbl, p.bbl);
  const share = taken / p.bbl;
  const rows: AttributionRow[] = remarkParcel(state, tank, p);
  for (const [k, v] of Object.entries(p.base)) if (Math.abs(v * share) >= 0.005) rows.push({ tick: state.tick, inst: "WTI", month: tank.id, leg: k === "flat" ? "flat" : k === "basis" ? "basis" : "time_spread", amount: -v * share, text: `${taken.toLocaleString()} bbl of ${p.label} drawn from tank ${tank.id}: the stored mark leaves the tank.` });
  p.bbl -= taken;
  for (const k of Object.keys(p.base)) p.base[k] *= 1 - share;
  if (p.bbl < 1) tank.parcels = tank.parcels.filter((x) => x.id !== p.id);
  return { rows, taken };
}

export function releaseTank(state: State, tank: Tank): string | null {
  if (tankInventory(tank) > 0) return `tank ${tank.id} still holds ${tankInventory(tank).toLocaleString()} bbl`;
  const committed = state.cargoes.find((c) => c.tankId === tank.id && c.sale && c.sale.paidTick === null);
  if (committed) return `tank ${tank.id} holds ${committed.id} until its sale is delivered and paid`;
  if (tank.chargesPaid < tank.months) {
    // the minimum term is paid out
    const left = tank.months - tank.chargesPaid;
    const amount = left * tank.capacityBbl * tank.costPerBblMonth;
    if (tank.currency === "EUR") markEur(state);
    ledger(state, "other", -amount, `Tank ${tank.id}: ${left} month${left > 1 ? "s" : ""} of the minimum term paid out on release`, tank.currency);
    state.pnl.attribution.push({ tick: state.tick, inst: "WTI", month: tank.id, leg: "storage", amount: -(tank.currency === "EUR" ? amount * state.factors.eurusd : amount), text: `Tank ${tank.id} released early: the ${left}-month balance of the minimum term is paid out.` });
    tank.chargesPaid = tank.months;
  }
  tank.released = true;
  return null;
}
