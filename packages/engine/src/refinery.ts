/**
 * The refinery (section 4, level 14 onward): one stylised plant with a fixed yield vector per crude slate, a run-rate
 * decision, a slate choice between two grades, and shutdowns from a hurricane or a turnaround. The plant's margin is
 * realised day by day at the day's marks and lands in the `refinery` leg; the crack hedge against it lives in the
 * futures book, where a 3-2-1 package's flat and basis parts cancel and only the crack and time-spread legs remain.
 */
import { CONVERSIONS, REFINERY } from "./refdata";
import { crack321 } from "./conversions";
import { ckey } from "./liquidity";
import { ledger } from "./finance";
import { GRADES, type Grade } from "./world_data";
import type { AttributionRow, EngineEvent, Refinery, State } from "./types";

export type Slate = "WTI_MIDLAND" | "ARAB_LIGHT";
export const SLATES: Slate[] = ["WTI_MIDLAND", "ARAB_LIGHT"];
const usd = (x: number): string => (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString();

export function initRefinery(init: { slate: Grade; runs: number }): Refinery {
  return { capacityKbd: REFINERY.capacityKbd.value, runs: Math.max(0, Math.min(1, init.runs)), slate: init.slate, shutUntil: null, maintenanceUntil: null, marginUsd: 0, daysRun: 0, history: [], base: 0, pendingSlate: null } as Refinery;
}

export interface MarginParts { perBbl: number; crack321: number; products: Record<"gasoline" | "diesel" | "jet" | "fuelOil", { yieldShare: number; price: number }>; crude: number; delivered: number; opex: number; why: string }

/** The plant's margin per barrel of crude on a slate at today's prompt prices, by part. */
export function refineryMarginPerBbl(state: State, slate: Grade): MarginParts {
  const f = state.factors;
  const wti = f.brentPrompt - f.bw;
  const y = REFINERY.yields.value[slate as Slate] ?? REFINERY.yields.value.WTI_MIDLAND;
  const products = {
    gasoline: { yieldShare: y.gasoline, price: wti + f.gasolineCrack },
    diesel: { yieldShare: y.diesel, price: wti + f.dieselCrack },
    jet: { yieldShare: y.jet, price: wti + f.dieselCrack + REFINERY.jetOverDiesel.value },
    fuelOil: { yieldShare: y.fuelOil, price: wti + f.fuelOilCrack },
  };
  const g = GRADES[slate];
  const bench = g.benchmark === "DUBAI" ? f.brentPrompt - f.dubaiEW : g.benchmark === "WTI" ? wti : f.brentPrompt + f.datedDiff;
  const crude = bench + f.gradeDiffs[slate];
  const delivered = REFINERY.deliveredCrudePerBbl.value[slate as Slate] ?? 1.5;
  const opex = REFINERY.opexPerBbl.value;
  const revenue = Object.values(products).reduce((a, p) => a + p.yieldShare * p.price, 0);
  const perBbl = revenue - crude - delivered - opex;
  const gal = CONVERSIONS.GAL_PER_BBL.value;
  const c321 = crack321((wti + f.gasolineCrack) / gal, (wti + f.dieselCrack) / gal, wti);
  const why = `${g.name} slate: ${Object.entries(products).map(([k, p]) => `${Math.round(p.yieldShare * 100)}% ${k} at ${p.price.toFixed(2)}`).join(", ")} (${Math.round(y.loss * 100)}% loss) = ${revenue.toFixed(2)} of product per barrel; less crude ${crude.toFixed(2)} (${g.benchmark} ${f.gradeDiffs[slate] >= 0 ? "+" : ""}${f.gradeDiffs[slate].toFixed(2)}), delivery ${delivered.toFixed(2)} and operating cost ${opex.toFixed(2)} = ${perBbl.toFixed(2)} $/bbl (stylised). The screen's 3-2-1 crack is ${c321.toFixed(2)}.`;
  return { perBbl, crack321: c321, products, crude, delivered, opex, why };
}

/** The run rate the plant can actually make: zero while shut, half in a turnaround, else the setting. */
export function effectiveRuns(state: State): number {
  const r = state.refinery;
  if (!r) return 0;
  if (r.shutUntil !== null && r.shutUntil > state.tick) return 0;
  if (r.maintenanceUntil !== null && r.maintenanceUntil > state.tick) return Math.min(r.runs, REFINERY.turnaroundRuns.value);
  return r.runs;
}

/** One day of running the plant at today's marks: cash and a `refinery` attribution row. Called once a day at the settle hour. */
export function runRefineryDay(state: State): { rows: AttributionRow[]; events: EngineEvent[] } {
  const r = state.refinery;
  const rows: AttributionRow[] = [];
  const events: EngineEvent[] = [];
  if (!r) return { rows, events };
  const pending = (r as Refinery & { pendingSlate?: Grade | null }).pendingSlate;
  if (pending) { r.slate = pending; (r as Refinery & { pendingSlate?: Grade | null }).pendingSlate = null; }
  const runs = effectiveRuns(state);
  const m = refineryMarginPerBbl(state, r.slate);
  const crudeBbl = r.capacityKbd * 1000 * runs;
  const fixed = REFINERY.fixedCostPerBblCapacityDay.value * r.capacityKbd * 1000;
  const margin = crudeBbl * m.perBbl - fixed;
  const day = Math.floor(state.tick / 24);
  ledger(state, "other", margin, `Refinery day ${day}: ${Math.round(crudeBbl).toLocaleString()} bbl of ${GRADES[r.slate].name} at ${m.perBbl.toFixed(2)} $/bbl less ${usd(fixed)} of fixed cost`);
  r.marginUsd += margin;
  r.daysRun += 1;
  r.history.push({ day, runs, crudeBbl, marginUsd: margin, marginPerBbl: m.perBbl, crack321: m.crack321 });
  const status = r.shutUntil !== null && r.shutUntil > state.tick ? "shut" : r.maintenanceUntil !== null && r.maintenanceUntil > state.tick ? "in turnaround" : "running";
  rows.push({ tick: state.tick, inst: "WTI", month: "plant", leg: "refinery", amount: margin, text: `The plant ${status}: ${Math.round(crudeBbl / 1000).toLocaleString()} kb of ${GRADES[r.slate].name} run at ${m.perBbl.toFixed(2)} $/bbl of margin (3-2-1 crack ${m.crack321.toFixed(2)}), less ${usd(fixed)} of fixed cost: ${usd(margin)} for the day.` });
  return { rows, events };
}

/** 3-2-1 crack units the futures book holds (positive = long the crack: long products, short crude). The package is 2 RBOB + 1 ULSD against 3 WTI. */
export function crackUnitsHeld(state: State): { units: number; rbob: number; ulsd: number; wti: number } {
  const net = (inst: "RBOB" | "ULSD" | "WTI") => state.lots.filter((l) => l.inst === inst && !l.option).reduce((a, l) => a + l.qty, 0);
  const rbob = net("RBOB"), ulsd = net("ULSD"), wti = net("WTI");
  const byRb = rbob / 2, byHo = ulsd, byCl = -wti / 3;
  const sameSign = Math.sign(byRb) === Math.sign(byHo) && Math.sign(byHo) === Math.sign(byCl);
  const units = sameSign ? Math.sign(byRb) * Math.min(Math.abs(byRb), Math.abs(byHo), Math.abs(byCl)) : 0;
  return { units, rbob, ulsd, wti };
}

/** The crack units a plant should be short to cover `horizonDays` of runs: crude barrels over the horizon in 3,000-bbl units. */
export function crackHedgeTargetUnits(state: State, horizonDays: number): number {
  const r = state.refinery;
  if (!r) return 0;
  return Math.round((r.capacityKbd * 1000 * r.runs * horizonDays) / 3000);
}

/** The front-month 3-2-1 crack from the screen's quotes, in $/bbl. */
export function screenCrack321(state: State): number | null {
  const q = (inst: "RBOB" | "ULSD" | "WTI") => state.quotes[ckey(inst, state.listed[inst][0])];
  const rb = q("RBOB"), ho = q("ULSD"), cl = q("WTI");
  if (!rb || !ho || !cl) return null;
  return crack321(rb.mid, ho.mid, cl.mid);
}
