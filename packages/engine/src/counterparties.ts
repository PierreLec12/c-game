/**
 * The named NPCs (section 4): producers, refiners, traders, shipowners, banks, an inspector. In milestone 2 they
 * issue tenders and quote freight; ratings, memory and defaults arrive in milestone 3. Every counterparty
 * implements the same two calls (quote, decide) so a human could stand in later (section 3.5).
 */
import { COUNTERPARTIES, GRADES, PORTS, SHIPPING, VESSEL_CLASSES, type Basis, type Grade } from "./world_data";
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
  requiresLc?: boolean;
  prepayDiscount?: number;
}

/** The market's fair differential for a grade on these terms: the grade grid, plus freight and insurance for a delivered price. */
export function fairDiff(state: State, grade: Grade, incoterm: Incoterm, port: string, basis: Basis, bbl?: number): number {
  const g = GRADES[grade];
  let diff = state.factors.gradeDiffs[grade];
  if (basis !== g.benchmark) {
    // translate between benchmarks at today's spreads
    const toBrent = (b: Basis) => (b === "DATED" ? state.factors.datedDiff : b === "DUBAI" ? -state.factors.dubaiEW : b === "WTI" ? -state.factors.bw : 0);
    diff += toBrent(g.benchmark) - toBrent(basis);
  }
  if (incoterm !== "FOB" && PORTS[port].node !== "") {
    const size = bbl ?? g.cargoKb * 1000;
    // freight is priced on the smallest class that carries the cargo, at the market's hire
    const cls = (["AFRAMAX", "SUEZMAX", "VLCC"] as const).find((c) => VESSEL_CLASSES[c].cargoKb.value * 1000 >= size) ?? "VLCC";
    const laden = require_ship().shortestPath(PORTS[g.loadPorts[0]].node, PORTS[port].node, require_ship().blockedNodes(state));
    const days = laden ? require_ship().daysFor(laden.nm, 12.5) : 15;
    const hire = require_ship().hireNow(state, cls);
    const bblForFreight = Math.max(size, VESSEL_CLASSES[cls].cargoKb.value * 1000 * 0.5);
    void bblForFreight;
    diff += (hire * (days + SHIPPING.portDaysInCharter.value) * (1 + SHIPPING.charterMarginShare.value)) / size + SHIPPING.insurancePerBbl.value;
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
  const fair = fairDiff(state, t.grade, t.incoterm, t.port, basis, t.bbl ?? grade.cargoKb * 1000);
  // an offer above fair is expensive for us; a bid below fair is cheap for us. The counterparty's edge works for them.
  const edgeSign = t.side === "offer" ? 1 : -1;
  const edge = cp.diffEdge + (state.counterparties?.[t.counterparty]?.edgeAdj ?? 0);
  const diff = Math.round((fair + edgeSign * edge + (t.diffVsFair ?? 0) + s.normal() * 0.05) * 100) / 100;
  const laycanDays = t.laycanDays ?? 2;
  const tender: Tender = {
    id: `T${++state.counters.tender}`, counterparty: t.counterparty, side: t.side, grade: t.grade, bbl: t.bbl ?? grade.cargoKb * 1000, incoterm: t.incoterm, port: t.port, basis, window: t.window, diff,
    laycan: [t.laycanStart, t.laycanStart + laycanDays], openedTick: state.tick, expiresTick: state.tick + (t.openHours ?? 48), status: "open",
    note: (t.note ?? (t.side === "offer" ? `${cp.name} offers ${grade.name}, ${t.incoterm} ${PORTS[t.port].name}, laycan days ${t.laycanStart}-${t.laycanStart + laycanDays}, ${basis} ${diff >= 0 ? "+" : ""}${diff.toFixed(2)}, ${windowLabel(t.window)}.` : `${cp.name} bids for ${grade.name}, ${t.incoterm} ${PORTS[t.port].name}, discharge days ${t.laycanStart}-${t.laycanStart + laycanDays}, ${basis} ${diff >= 0 ? "+" : ""}${diff.toFixed(2)}, ${windowLabel(t.window)}.`)) + (t.requiresLc ? " A letter of credit is required before loading." : "") + (t.prepayDiscount ? ` Prepay and the differential drops by ${t.prepayDiscount.toFixed(2)}.` : ""),
    trap: t.trap ?? null, fairDiff: fair, requiresLc: t.requiresLc ?? false, prepayDiscount: t.prepayDiscount ?? 0, countered: null, declineReason: null,
  };
  state.tenders.push(tender);
  return tender;
}

export function windowLabel(w: WindowSpec): string {
  return w.kind === "after_bl" ? `${w.days ?? 5} days after B/L` : w.kind === "after_discharge" ? `${w.days ?? 5} days after discharge` : w.kind === "month_avg_bl" ? "B/L month average" : w.kind === "month_avg_offset" ? `average of the month ${w.offsetMonths ?? 1} after the B/L month` : `deemed B/L day ${w.deemedDay}`;
}

export function expireTenders(state: State): Tender[] {
  const out: Tender[] = [];
  for (const t of state.tenders) if (t.status === "open" && t.expiresTick <= state.tick) { t.status = "expired"; out.push(t); }
  return out;
}

export const ticksPerDay = HOURS_PER_DAY;
export const counterpartyName = (id: string): string => COUNTERPARTIES[id]?.name ?? id;

// ---------------------------------------------------------------- milestone 3: ratings, memory, exposure, decisions
import { CREDIT, RATING_SCORES, ratingFor } from "./world_data";
import type { Cargo, CounterpartyState, EngineEvent } from "./types";
import { publishNews as news } from "./information";

export function initCounterparties(): Record<string, CounterpartyState> {
  const out: Record<string, CounterpartyState> = {};
  for (const cp of Object.values(COUNTERPARTIES)) out[cp.id] = { id: cp.id, rating: cp.rating, ratingScore: RATING_SCORES[cp.rating] ?? 70, edgeAdj: 0, disputes: 0, late: 0, defaulted: false, gone: false, dealsWithPlayer: 0, note: cp.profile };
  return out;
}

/** The counterparty's effective differential edge: its profile plus what it remembers of you. */
export function effectiveEdge(state: State, cpId: string): number {
  return (COUNTERPARTIES[cpId]?.diffEdge ?? 0) + (state.counterparties[cpId]?.edgeAdj ?? 0);
}

/** A dispute is remembered: the counterparty quotes worse from now on. */
export function rememberDispute(state: State, cpId: string, what: string): void {
  const c = state.counterparties[cpId];
  if (!c) return;
  c.disputes += 1;
  c.edgeAdj += CREDIT.disputeEdgePenalty.value;
  c.note = `${COUNTERPARTIES[cpId].profile}; remembers ${what} (quotes ${c.edgeAdj.toFixed(2)} worse)`;
}

export function moveRating(state: State, cpId: string, delta: number, why: string): EngineEvent[] {
  const c = state.counterparties[cpId];
  if (!c) return [];
  c.ratingScore = Math.max(0, Math.min(100, c.ratingScore + delta));
  const before = c.rating;
  c.rating = ratingFor(c.ratingScore);
  if (c.rating === before) return [];
  const n = news(state, { source: "wire", headline: `${COUNTERPARTIES[cpId].name} ${delta < 0 ? "downgraded" : "upgraded"} to ${c.rating}`, body: why });
  return [{ kind: "credit", tick: state.tick, text: n.headline, pause: delta < 0 }];
}

/** Exposure to each counterparty: undelivered cargo value bought from a seller, unpaid or unpriced sales to a buyer. */
export function counterpartyExposure(state: State): { byId: Record<string, number>; total: number; largest: { id: string; share: number } | null } {
  const byId: Record<string, number> = {};
  for (const c of state.cargoes) {
    if (c.status === "cancelled") continue;
    const price = c.purchase.fixed ?? state.factors.brentPrompt;
    if (c.status !== "delivered" && c.status !== "discharging") byId[c.purchase.counterparty] = (byId[c.purchase.counterparty] ?? 0) + c.bbl * price + (c.prepaidUsd ?? 0);
    else if (c.prepaidUsd > 0 && c.purchase.paidTick === null) byId[c.purchase.counterparty] = (byId[c.purchase.counterparty] ?? 0) + c.prepaidUsd;
    if (c.sale && c.sale.paidTick === null) byId[c.sale.counterparty] = (byId[c.sale.counterparty] ?? 0) + c.bbl * (c.sale.fixed ?? price);
  }
  const total = Object.values(byId).reduce((a, b) => a + b, 0);
  let largest: { id: string; share: number } | null = null;
  for (const [id, v] of Object.entries(byId)) if (total > 0 && (!largest || v / total > largest.share)) largest = { id, share: v / total };
  return { byId, total, largest };
}

/** Will the counterparty take the player's counter on a tender? Reliable names move a dime; aggressive ones more; a remembered dispute closes the gap. */
export function decideCounter(state: State, tenderId: string, diff: number): { accepted: boolean; text: string } {
  const t = state.tenders.find((x) => x.id === tenderId)!;
  const cp = COUNTERPARTIES[t.counterparty];
  const cs = state.counterparties[t.counterparty];
  const tol = (cp.type === "trader" && cp.diffEdge < 0 ? CREDIT.counterToleranceAggressive.value : CREDIT.counterToleranceReliable.value) - 0.5 * (cs?.edgeAdj ?? 0);
  const move = t.side === "offer" ? t.diff - diff : diff - t.diff; // how much better for us than their quote
  if (move <= 0) return { accepted: true, text: `${cp.name} accepts ${diff >= 0 ? "+" : ""}${diff.toFixed(2)}: it is no worse for them than their own quote.` };
  if (move <= tol + 1e-9) return { accepted: true, text: `${cp.name} accepts ${diff >= 0 ? "+" : ""}${diff.toFixed(2)} (they would move up to ${tol.toFixed(2)}).` };
  return { accepted: false, text: `${cp.name} declines ${diff >= 0 ? "+" : ""}${diff.toFixed(2)}: they will not move more than ${tol.toFixed(2)} from ${t.diff >= 0 ? "+" : ""}${t.diff.toFixed(2)}.` };
}

/** A seller defaults: the cargo is cancelled; if it had been sold on, the receiver claims; insurance recovers most of it. */
export function sellerDefault(state: State, cargo: Cargo, reason: string): EngineEvent[] {
  const events: EngineEvent[] = [];
  const cs = state.counterparties[cargo.purchase.counterparty];
  if (cs) { cs.defaulted = true; cs.dealsWithPlayer += 1; }
  events.push(...moveRating(state, cargo.purchase.counterparty, -40, reason));
  return events;
}

export const cpState = (state: State, id: string): CounterpartyState | undefined => state.counterparties[id];
