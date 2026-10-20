/**
 * The named NPCs (section 4): producers, refiners, traders, shipowners, banks, an inspector. In milestone 2 they
 * issue tenders and quote freight; ratings, memory and defaults arrive in milestone 3. Every counterparty
 * implements the same two calls (quote, decide) so a human could stand in later (section 3.5).
 */
import { COUNTERPARTIES, GRADES, PORTS, SHIPPING, type Basis, type Grade } from "./world_data";
import type { Incoterm, State, Tender, WindowSpec } from "./types";
import type { Stream } from "./rng";
import { HOURS_PER_DAY } from "./calendar";

export interface TenderTemplate {
  counterparty: string;
  side: "offer" | "bid";
  grade: Grade;
  bbl?: number;
  incoterm: Incoterm;
  port: string;
  basis?: Basis;
  window: WindowSpec;
  /** differential versus the market's fair differential; the counterparty's own edge is added */
  diffVsFair?: number;
  laycanStart: number; // level day
  laycanDays?: number;
  openHours?: number;
  note?: string;
  trap?: string;
}

/** The market's fair differential for a grade on these terms: the grade grid, plus freight and insurance for a delivered price. */
export function fairDiff(state: State, grade: Grade, incoterm: Incoterm, port: string, basis: Basis): number {
  const g = GRADES[grade];
  let diff = state.factors.gradeDiffs[grade];
  if (basis !== g.benchmark) {
    // translate between benchmarks at today's spreads
    const toBrent = (b: Basis) => (b === "DATED" ? state.factors.datedDiff : b === "DUBAI" ? -state.factors.dubaiEW : b === "WTI" ? -state.factors.bw : 0);
    diff += toBrent(g.benchmark) - toBrent(basis);
  }
  if (incoterm !== "FOB") {
    const bbl = g.cargoKb * 1000;
    const laden = require_ship().shortestPath(PORTS[g.loadPorts[0]].node, PORTS[port].node, require_ship().blockedNodes(state));
    const days = laden ? require_ship().daysFor(laden.nm, 12.5) : 15;
    const hire = require_ship().hireNow(state, g.cls);
    diff += (hire * (days + SHIPPING.portDaysInCharter.value) * (1 + SHIPPING.charterMarginShare.value)) / bbl + SHIPPING.insurancePerBbl.value;
  }
  return Math.round(diff * 100) / 100;
}
import * as ship from "./shipping";
function require_ship() { return ship; }

/** Issue a tender from a template: the counterparty's edge and a little noise go on top of the fair differential. */
export function issueTender(state: State, t: TenderTemplate, s: Stream): Tender {
  const cp = COUNTERPARTIES[t.counterparty];
  const grade = GRADES[t.grade];
  const basis = t.basis ?? grade.benchmark;
  const fair = fairDiff(state, t.grade, t.incoterm, t.port, basis);
  // an offer above fair is expensive for us; a bid below fair is cheap for us. The counterparty's edge works for them.
  const edgeSign = t.side === "offer" ? 1 : -1;
  const diff = Math.round((fair + edgeSign * cp.diffEdge + (t.diffVsFair ?? 0) + s.normal() * 0.05) * 100) / 100;
  const laycanDays = t.laycanDays ?? 2;
  const tender: Tender = {
    id: `T${++state.counters.tender}`, counterparty: t.counterparty, side: t.side, grade: t.grade, bbl: t.bbl ?? grade.cargoKb * 1000, incoterm: t.incoterm, port: t.port, basis, window: t.window, diff,
    laycan: [t.laycanStart, t.laycanStart + laycanDays], openedTick: state.tick, expiresTick: state.tick + (t.openHours ?? 48), status: "open",
    note: t.note ?? (t.side === "offer" ? `${cp.name} offers ${grade.name}, ${t.incoterm} ${PORTS[t.port].name}, laycan days ${t.laycanStart}-${t.laycanStart + laycanDays}, ${basis} ${diff >= 0 ? "+" : ""}${diff.toFixed(2)}, ${windowLabel(t.window)}.` : `${cp.name} bids for ${grade.name}, ${t.incoterm} ${PORTS[t.port].name}, discharge days ${t.laycanStart}-${t.laycanStart + laycanDays}, ${basis} ${diff >= 0 ? "+" : ""}${diff.toFixed(2)}, ${windowLabel(t.window)}.`),
    trap: t.trap ?? null, fairDiff: fair,
  };
  state.tenders.push(tender);
  return tender;
}

export function windowLabel(w: WindowSpec): string {
  return w.kind === "after_bl" ? `${w.days ?? 5} days after B/L` : w.kind === "after_discharge" ? `${w.days ?? 5} days after discharge` : w.kind === "month_avg_bl" ? "B/L month average" : `deemed B/L day ${w.deemedDay}`;
}

export function expireTenders(state: State): Tender[] {
  const out: Tender[] = [];
  for (const t of state.tenders) if (t.status === "open" && t.expiresTick <= state.tick) { t.status = "expired"; out.push(t); }
  return out;
}

export const ticksPerDay = HOURS_PER_DAY;
export const counterpartyName = (id: string): string => COUNTERPARTIES[id]?.name ?? id;
