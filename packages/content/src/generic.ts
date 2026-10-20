/**
 * The generic trading policy of tier 5: what a careful desk does with a full tender flow. Take the cheap offers the line can
 * carry, sell into bids at or above fair (never to a name that pays late and is rated low), counter once when a quote is
 * close, fix the cheapest fitting ship, open the letter of credit a seller wants, prepay for a real discount, hedge every leg
 * in the contract it prices on, settle claims, take the cheaper way past a restricted strait, anchor for a berth queue, and
 * keep the crack hedge of a plant to the days it will run. Levels 19 and 20 are this policy with their own schedules.
 */
import { COUNTERPARTIES, basisPrice, charterQuotes, lineAvailable, passageOptions, physicalExposureBbl, type Action, type Basis, type InstrumentId, type State, type Tender } from "@desk/engine";
import { P, accept, anchorDaysForQueue, gasHedgeAdjustment, gasHedgeChunk, gasHedgeMonth, hour, isOpen, hedgeOrder, net, quizAnswers, rollExpiringHedges } from "./bot";
import { instOfBasis, unitsPerLot } from "./bot";

export interface GenericOpts {
  /** $/unit under fair an offer must be to take it */
  minEdge: number;
  /** cargoes the desk will carry at once */
  maxCargoes: number;
  /** end the level on this day (endless levels) */
  endDay?: number;
  /** the hedge month index per instrument when nothing is held */
  monthIdx?: number;
  /** $/unit under fair a bid may be and still be taken for oil the desk holds (Partner's bids are priced against a known holder) */
  sellTol: number;
}
const DEFAULTS: GenericOpts = { minEdge: 0.2, maxCargoes: 3, monthIdx: 1, sellTol: 0.1 };

const openCargoes = (s: State) => s.cargoes.filter((c) => c.status !== "cancelled" && !(c.status === "delivered" && c.sale && c.sale.paidTick !== null && c.purchase.paidTick !== null));
const lowRated = (s: State, cp: string) => (s.counterparties[cp]?.ratingScore ?? 70) < 55 || (s.counterparties[cp]?.late ?? 0) > 0 || (s.counterparties[cp]?.defaulted ?? false) || (s.counterparties[cp]?.gone ?? false) || (COUNTERPARTIES[cp]?.flaky ?? 0) >= 0.3;
/** A pricing window a month after loading hides a time spread (level 8's lesson); the quarter declines it whatever the differential. */
const hiddenSpread = (t: Tender) => t.window.kind === "month_avg_offset";

/** Crude hedge adjustment in lots for one instrument, from every basis that prices on it (Dated and Brent both hedge in Brent). */
function crudeAdjustment(s: State, inst: InstrumentId): number {
  const ex = physicalExposureBbl(s).byBasis;
  let units = 0;
  for (const [b, v] of Object.entries(ex)) if (instOfBasis(b as Basis) === inst && !["HH", "TTF", "JKM"].includes(b)) units += v ?? 0;
  return Math.round(-units / 1000) - net(s, inst);
}
/** A chunk a tick: a VLCC must be hedged within a day, so the chunk is 200 lots (the spread book's depth stands it) and smaller only when the gap is small. */
function chunkFor(s: State, inst: InstrumentId, month: string, gap: number): number {
  const q = s.quotes[`${inst}:${month}`];
  const gentle = Math.max(50, 2 * (q?.depth ?? 25));
  return Math.abs(gap) >= 300 ? 200 : Math.min(gentle, 200);
}
/** What the curve charges (or pays) to carry a cargo from today to its expected sale window, $/unit: positive in backwardation. */
function carryCost(s: State, t: Tender): number {
  const days = t.incoterm === "FOB" ? 30 : 10;
  const today = Math.floor(s.tick / 24);
  return basisPrice(s, t.basis, today) - basisPrice(s, t.basis, today + days);
}

export function genericTrade(s: State, o: Partial<GenericOpts> = {}): Action[] {
  const opts = { ...DEFAULTS, ...o };
  if (s.level.status === "ended") return quizAnswers(s);
  if (s.level.status !== "running") return [];
  const day = Math.floor(s.tick / 24);
  const h = hour(s);
  if (opts.endDay !== undefined && day >= opts.endDay && h === 10) return [{ type: "end_level", player: P }];
  const acts: Action[] = [];
  const open = s.tenders.filter((t) => t.status === "open" && t.expiresTick > s.tick);
  // offers: take the cheap ones the line can carry; counter the near-fair ones once; decline the rest with a reason an hour before they close
  for (const t of open.filter((x) => x.side === "offer")) {
    // the edge must pay for carrying the oil through a backwardated curve to its sale window (level 8's lesson), and a contango helps
    const edge = t.fairDiff - t.diff - carryCost(s, t);
    const carrying = openCargoes(s).length;
    const est = (s.factors.brentPrompt + t.diff) * t.bbl;
    const canCarry = carrying < opts.maxCargoes && est < lineAvailable(s) + s.finance.cashUSD;
    const clean = !lowRated(s, t.counterparty) && !hiddenSpread(t);
    if (edge >= opts.minEdge && canCarry && clean) { acts.push(accept(t.id, undefined)); continue; }
    if (!t.countered && canCarry && edge > -0.15 && edge < opts.minEdge && clean) { acts.push({ type: "counter_tender", player: P, tenderId: t.id, diff: Math.round((t.diff - 0.1) * 100) / 100 }); continue; }
    if (t.expiresTick - s.tick <= 2) acts.push({ type: "decline_tender", player: P, tenderId: t.id, reason: hiddenSpread(t) ? "a month-average window a month after loading hides a time spread" : lowRated(s, t.counterparty) ? `${t.counterparty} is rated too low, flaky, or has paid late` : !canCarry ? "the line is full" : `${(t.fairDiff - t.diff).toFixed(2)} under fair does not pay the curve's ${carryCost(s, t).toFixed(2)} of carry to the window` });
  }
  if (acts.length) return acts;
  // bids: sell an unsold cargo of the grade to a bid at or above fair from a name that pays; counter a near bid once
  for (const t of open.filter((x) => x.side === "bid")) {
    const cargo = s.cargoes.find((c) => c.grade === t.grade && !c.sale && c.status !== "cancelled" && (c.tankId !== null || (c.status !== "delivered" && c.status !== "discharging")) && Math.abs(c.bbl - t.bbl) <= 0.15 * t.bbl);
    if (!cargo) continue;
    if (lowRated(s, t.counterparty)) { if (t.expiresTick - s.tick <= 2) acts.push({ type: "decline_tender", player: P, tenderId: t.id, reason: "a buyer that pays late or is rated low" }); continue; }
    if (t.diff >= t.fairDiff - 0.05) { acts.push(accept(t.id, cargo.id)); continue; }
    // a dime is what a reliable name will move: ask for it once, then take what the oil is worth to a holder
    if (!t.countered && t.diff >= t.fairDiff - 0.6) { acts.push({ type: "counter_tender", player: P, tenderId: t.id, diff: Math.round((t.diff + 0.1) * 100) / 100 }); continue; }
    if (t.diff >= t.fairDiff - opts.sellTol) { acts.push(accept(t.id, cargo.id)); continue; }
    if (t.expiresTick - s.tick <= 2) acts.push({ type: "decline_tender", player: P, tenderId: t.id, reason: `${(t.fairDiff - t.diff).toFixed(2)} under fair` });
  }
  if (acts.length) return acts;
  for (const c of s.cargoes) {
    if (c.status === "cancelled") continue;
    if (c.requiresLc && !c.lcId && (c.status === "contracted" || c.status === "fixed")) { acts.push({ type: "open_lc", player: P, cargoId: c.id }); break; }
    if (!c.vesselId && c.status === "contracted" && s.vessels.length) { const q = charterQuotes(s, c).find((x) => x.fits && x.etaLoadDay <= c.laycan[1]); if (q) { acts.push({ type: "fix_charter", player: P, cargoId: c.id, vesselId: q.vesselId }); break; } }
    const v = s.voyages.find((x) => x.id === c.voyageId);
    if (v && v.status === "waiting_chokepoint" && v.waitUntil === null) { const po = passageOptions(s, v); acts.push({ type: "instruct_ship", player: P, cargoId: c.id, passage: po.reroute && po.reroute.costUsd < po.proceed.costUsd ? "reroute" : "proceed" }); break; }
    if (v && v.status === "laden" && v.anchorUntil === null) { const d = anchorDaysForQueue(s, c); if (d > 0) { acts.push({ type: "instruct_ship", player: P, cargoId: c.id, anchorDays: d }); break; } }
    const claim = c.claims.find((k) => k.status === "open");
    if (claim) { acts.push({ type: "settle_claim", player: P, cargoId: c.id, claimId: claim.id }); break; }
  }
  if (acts.length) return acts;
  // hedges: every basis in its own contract, through the liquid hours, one chunk a tick; a hedge month about to expire is rolled first
  if (isOpen(s) && h >= 7 && h <= 20) {
    const roll = rollExpiringHedges(s, 5, 2);
    if (roll) return [roll];
    for (const inst of ["BRENT", "WTI", "DUBAI"] as const) {
      if (!s.level.instruments.includes(inst)) continue;
      const month = s.lots.find((l) => l.inst === inst && !l.option)?.month ?? s.listed[inst][Math.min(opts.monthIdx ?? 1, s.listed[inst].length - 1)];
      const adj = crudeAdjustment(s, inst);
      const limit = s.risk.limits.netLots[inst];
      const bounded = Math.max(-limit * 0.9 - net(s, inst), Math.min(limit * 0.9 - net(s, inst), adj));
      if (Math.abs(bounded) >= 5) return [hedgeOrder(inst, month, bounded > 0 ? "buy" : "sell", Math.min(Math.abs(bounded), chunkFor(s, inst, month, bounded)))];
    }
    for (const basis of ["HH", "TTF", "JKM"] as const) {
      if (!s.level.instruments.includes(instOfBasis(basis))) continue;
      const o2 = gasHedgeChunk(basis, gasHedgeMonth(s, basis, basis === "HH" ? 1 : 2), gasHedgeAdjustment(s, basis));
      if (o2) return [o2];
    }
  }
  return [];
}
