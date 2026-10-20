/** Shared helpers for the solution bots and the level checks. */
import { ckey, hourOfTick, type Action, type AttributionLeg, type InstrumentId, type State } from "@desk/engine";
import { charterQuotes, physicalExposureBbl, physicalExposureAfterPrintsBbl, legMark, type Cargo, type Basis, INSTRUMENTS, CONVERSIONS } from "@desk/engine";

export const P = "p1";
export const front = (s: State, inst: InstrumentId = "BRENT"): string => s.listed[inst][0];
export const second = (s: State, inst: InstrumentId = "BRENT"): string => s.listed[inst][1];
export const levelDay = (s: State): number => Math.floor(s.tick / 24);
export const hour = (s: State): number => hourOfTick(s.tick);
export const at = (s: State, day: number, h: number): boolean => s.tick === day * 24 + h;
/** Net futures lots (options are counted by their delta elsewhere). */
export const net = (s: State, inst: InstrumentId, month?: string): number => s.lots.filter((l) => !l.option && l.inst === inst && (month === undefined || l.month === month)).reduce((a, l) => a + l.qty, 0);
export const gross = (s: State): number => s.lots.filter((l) => !l.option).reduce((a, l) => a + Math.abs(l.qty), 0);
export const mid = (s: State, inst: InstrumentId, month: string): number => s.quotes[ckey(inst, month)]?.mid ?? 0;
export const isOpen = (s: State): boolean => s.quotes[ckey("BRENT", front(s))]?.open ?? false;

export const buy = (inst: InstrumentId, month: string, qty: number): Action => ({ type: "order", player: P, inst, month, side: "buy", qty, kind: "market" });
export const sell = (inst: InstrumentId, month: string, qty: number): Action => ({ type: "order", player: P, inst, month, side: "sell", qty, kind: "market" });
export const close = (inst: InstrumentId, month: string): Action => ({ type: "close", player: P, inst, month });

export function flatten(s: State): Action[] {
  const seen = new Set<string>();
  const out: Action[] = [];
  for (const l of s.lots) {
    if (l.option) continue;
    const k = ckey(l.inst, l.month);
    if (seen.has(k)) continue;
    seen.add(k);
    if (net(s, l.inst, l.month) !== 0) out.push(close(l.inst, l.month));
  }
  return out;
}

/** Answer every open quiz question correctly: the bot is the player who understood the level. */
export function quizAnswers(s: State): Action[] {
  return s.level.quiz.filter((q) => q.given === undefined).map((q) => ({ type: "answer_quiz", player: P, questionId: q.id, choice: q.correct }));
}
export function drillAnswers(s: State): Action[] {
  return s.level.drills.filter((d) => d.given === undefined || !d.correct).map((d) => ({ type: "answer_drill", player: P, drillId: d.id, answer: d.answer }));
}

export const usd = (x: number): string => (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString();

/** brentRef such that the level's anchor sits at `price` given its inventory gap and geo index (so the level starts in equilibrium). */
export function refFor(price: number, oecdInvGap: number, geo = 0.2): number {
  return price / Math.exp(-0.004 * oecdInvGap + 0.18 * geo);
}

export function leg(s: State, name: AttributionLeg): number {
  return s.pnl.attribution.filter((r) => r.leg === name).reduce((a, r) => a + r.amount, 0);
}

// ---------------------------------------------------------------- common objective checks
export const varInsideEveryClose = (s: State): "pending" | "done" | "failed" => (s.risk.varBreachedAtClose ? "failed" : s.risk.closesTotal > 0 ? "done" : "pending");
export const noMarginCall = (s: State): "pending" | "done" | "failed" => (s.finance.marginCalls > 0 ? "failed" : s.fills.length > 0 ? "done" : "pending");
export const positivePnl = (s: State): "pending" | "done" | "failed" => (s.level.status === "running" ? (s.pnl.total > 0 ? "done" : "pending") : s.pnl.total > 0 ? "done" : "failed");
export const grossUnderLimitEveryClose = (s: State): "pending" | "done" | "failed" => (s.risk.breaches.some((b) => b.limit === "grossLots") ? "failed" : s.risk.closesTotal > 0 ? "done" : "pending");

export const TIER1_UNLOCKS: Action["type"][] = ["order", "close", "cancel_order", "draw_line", "repay_line", "post_margin", "open_card", "ask_mentor", "answer_drill", "answer_quiz", "end_level", "request_limit"];
export const TIER1_LIMITS_NONE = { BRENT: 0, WTI: 0, RBOB: 0, ULSD: 0, HH: 0, TTF: 0, DUBAI: 0, JKM: 0 };

// ---------------------------------------------------------------- physical helpers for the tier 2 bots and checks

export const openOffers = (s: State) => s.tenders.filter((t) => t.side === "offer" && t.status === "open");
export const openBids = (s: State) => s.tenders.filter((t) => t.side === "bid" && t.status === "open");
export const cargo0 = (s: State): Cargo | undefined => s.cargoes[0];
export const voyageOf = (s: State, c: Cargo | undefined) => (c ? s.voyages.find((v) => v.id === c.voyageId) : undefined);
export const accept = (tenderId: string, cargoId?: string): Action => ({ type: "accept_tender", player: P, tenderId, cargoId });
export const fixCheapest = (s: State, c: Cargo): Action | null => {
  const q = charterQuotes(s, c).find((x) => x.fits && x.etaLoadDay <= c.laycan[1]);
  return q ? { type: "fix_charter", player: P, cargoId: c.id, vesselId: q.vesselId } : null;
};
export const hedgeOrder = (inst: InstrumentId, month: string, side: "buy" | "sell", qty: number): Action => ({ type: "order", player: P, inst, month, side, qty, kind: "market", tag: "hedge" });

/** Futures lots to sell (negative: buy) so that paper offsets the net physical barrels, given what is already held. */
export function hedgeAdjustment(s: State, inst: InstrumentId = "BRENT"): number {
  const phys = physicalExposureBbl(s).bbl;
  const held = net(s, inst) * 1000;
  const wanted = -phys;
  return Math.round((wanted - held) / 1000); // lots to buy (positive) or sell (negative)
}

/** The hedge ratio at this moment: futures barrels against physical barrels, 1 = flat. Null when the physical exposure is small. */
export function hedgeRatio(s: State, inst: InstrumentId = "BRENT"): number | null {
  const phys = physicalExposureBbl(s).bbl;
  if (Math.abs(phys) < 50000) return null;
  const held = net(s, inst) * 1000;
  return -held / phys;
}

export const unpricedShare = (s: State, c: Cargo, which: "purchase" | "sale"): number => {
  const leg = which === "purchase" ? c.purchase : c.sale;
  if (!leg) return 0;
  const m = legMark(s, c, leg);
  return m.unpriced.length / m.n;
};

export const TIER2_UNLOCKS: Action["type"][] = [...TIER1_UNLOCKS, "spread", "roll", "accept_tender", "decline_tender", "fix_charter", "instruct_ship", "efp", "settle_claim", "contest_claim"];
export const TIER2_LIMITS = (brent: number) => ({ BRENT: brent, WTI: 0, RBOB: 0, ULSD: 0, HH: 0, TTF: 0, DUBAI: brent, JKM: 0 });

/** Closes with real physical exposure, and how many had futures within `tol` of a one-to-one hedge in `inst`. */
export function hedgeRecord(s: State, inst: InstrumentId = "BRENT", tol = 0.1, minBbl = 100000): { inside: number; total: number } {
  let inside = 0, total = 0;
  for (const c of s.risk.closes) {
    if (Math.abs(c.physBbl) < minBbl) continue;
    total += 1;
    const ratio = -(c.net[inst] * 1000) / c.physBbl;
    if (Math.abs(ratio - 1) <= tol) inside += 1;
  }
  return { inside, total };
}

/** Net physical barrels after today's window days print at the close: what the close snapshot will show. */
export const physicalExposureAfterPrints = (s: State): number => physicalExposureAfterPrintsBbl(s);
/** The most lots one hedge order sends: inside the block rule and gentle on the book (stylised desk practice). */
export const HEDGE_CHUNK: Record<string, number> = { BRENT: 120, WTI: 120, DUBAI: 150 };
/** A chunked hedge order, or null when the adjustment is below five lots. */
export function hedgeChunk(inst: InstrumentId, month: string, lots: number): Action | null {
  if (Math.abs(lots) < 5) return null;
  const qty = Math.min(Math.abs(lots), HEDGE_CHUNK[inst] ?? 250);
  return hedgeOrder(inst, month, lots > 0 ? "buy" : "sell", qty);
}
/** Lots to buy (positive) or sell so paper offsets the physical barrels as they will stand at today's close. */
export function hedgeAdjustmentAhead(s: State, inst: InstrumentId = "BRENT"): number {
  const phys = physicalExposureAfterPrints(s);
  const held = net(s, inst) * 1000;
  return Math.round((-phys - held) / 1000);
}
/** Days to hold at anchor so notice of readiness comes after a port's queue clears (0 when there is no queue ahead of the ETA). */
export function anchorDaysForQueue(s: State, c: Cargo): number {
  const v = s.voyages.find((x) => x.id === c.voyageId);
  if (!v) return 0;
  const until = s.portCongestion[c.dischargePort] ?? 0;
  if (until <= v.eta) return 0;
  return Math.ceil((until - v.eta) / 24);
}

export const TIER3_UNLOCKS: Action["type"][] = [...TIER2_UNLOCKS, "open_lc", "insure", "counter_tender", "lease_tank", "store_cargo", "blend", "release_tank"];
export const TIER3_LIMITS = (brent: number, wti = 0, dubai = brent) => ({ BRENT: brent, WTI: wti, RBOB: 0, ULSD: 0, HH: 0, TTF: 0, DUBAI: dubai, JKM: 0 });
export const cashNeverNegative = (s: State): "pending" | "done" | "failed" => (s.risk.closes.some((c) => c.cashUsd < -1) || s.finance.marginCalls > 0 ? "failed" : s.risk.closes.length > 0 ? "done" : "pending");
export const insideLimitsEveryClose = (s: State): "pending" | "done" | "failed" => (s.risk.closesTotal === 0 ? "pending" : s.risk.varBreachedAtClose || s.risk.forcedReductions > 0 || s.risk.messages.some((m) => m.severity === "warning" || m.severity === "breach") ? "failed" : "done");
export const cargoFrom = (s: State, cp: string): Cargo | undefined => s.cargoes.find((c) => c.purchase.counterparty === cp);

/** A roll for any held futures month that expires within `daysAhead` days: to the listed month `toIdx` out (a hedge that must outlive its contract). */
export function rollExpiringHedges(s: State, daysAhead = 5, toIdx = 2): Action | null {
  const seen = new Set<string>();
  for (const l of s.lots) {
    if (l.option) continue;
    const key = `${l.inst}:${l.month}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = s.contracts[key];
    if (!c || c.expiryTick - s.tick > daysAhead * 24) continue;
    const months = s.listed[l.inst];
    const to = months[Math.min(toIdx, months.length - 1)];
    if (!to || to <= l.month) continue;
    const n = net(s, l.inst, l.month);
    if (n === 0) continue;
    // the whole position in one order when the touch can take it; otherwise a chunk a tick through the spread book
    const depth = s.quotes[key]?.depth ?? 25;
    const chunk = Math.max(50, Math.min(Math.abs(n), 8 * depth, 600));
    if (Math.abs(n) <= chunk) return { type: "roll", player: P, inst: l.inst, from: l.month, to };
    const closeSide: "buy" | "sell" = n > 0 ? "sell" : "buy";
    return { type: "spread", player: P, name: "time", legs: [{ inst: l.inst, month: l.month, side: closeSide, qty: chunk }, { inst: l.inst, month: to, side: closeSide === "buy" ? "sell" : "buy", qty: chunk }] };
  }
  return null;
}

// ---------------------------------------------------------------- tier 4: products, gas, options, signals
export const TIER4_UNLOCKS: Action["type"][] = [...TIER3_UNLOCKS, "option_order", "option_strategy", "set_runs", "set_slate", "book_regas", "buy_feed"];
export const TIER4_LIMITS = (over: Partial<Record<InstrumentId, number>>) => ({ BRENT: 0, WTI: 0, RBOB: 0, ULSD: 0, HH: 0, TTF: 0, DUBAI: 0, JKM: 0, ...over });
/** Units of a gas basis per lot of the contract that hedges it: HH and JKM lots are 10,000 MMBtu; a TTF lot is 720 MWh, or 720 x 3.412 MMBtu. */
export const unitsPerLot = (basis: Basis): number => (basis === "TTF" ? INSTRUMENTS.TTF.lot * CONVERSIONS.MMBTU_PER_MWH.value : basis === "HH" || basis === "JKM" ? INSTRUMENTS.HH.lot : 1000);
export const instOfBasis = (basis: Basis): InstrumentId => (basis === "HH" ? "HH" : basis === "TTF" ? "TTF" : basis === "JKM" ? "JKM" : basis === "WTI" ? "WTI" : basis === "DUBAI" ? "DUBAI" : "BRENT");
/** Lots to buy (positive) or sell in the contract of `basis` so paper offsets the physical units priced on it. */
export function gasHedgeAdjustment(s: State, basis: Basis, units = physicalExposureBbl(s).byBasis[basis] ?? 0): number {
  const inst = instOfBasis(basis);
  const held = s.lots.filter((l) => l.inst === inst && !l.option).reduce((a, l) => a + l.qty, 0);
  return Math.round(-units / unitsPerLot(basis)) - held;
}
export const GAS_CHUNK: Record<string, number> = { HH: 100, TTF: 100, JKM: 50 };
/** The month a gas hedge trades in: the month already held in that contract, else the listed month `idx` out. */
export const gasHedgeMonth = (s: State, basis: Basis, idx = 2): string => { const inst = instOfBasis(basis); return s.lots.find((l) => l.inst === inst && !l.option)?.month ?? s.listed[inst][Math.min(idx, s.listed[inst].length - 1)]; };
export function gasHedgeChunk(basis: Basis, month: string, lots: number): Action | null {
  if (Math.abs(lots) < 3) return null;
  const inst = instOfBasis(basis);
  return hedgeOrder(inst, month, lots > 0 ? "buy" : "sell", Math.min(Math.abs(lots), GAS_CHUNK[inst] ?? 100));
}
/** Closes with physical units on a gas basis, and how many had the right contract within `tol` of a one-to-one hedge. */
export function gasHedgeRecord(s: State, basis: Basis, tol = 0.25, minUnits = 500000): { inside: number; total: number } {
  let inside = 0, total = 0;
  const inst = instOfBasis(basis);
  for (const c of s.risk.closes) {
    const units = c.byBasis?.[basis] ?? 0;
    if (Math.abs(units) < minUnits) continue;
    total += 1;
    const ratio = -(c.net[inst] * unitsPerLot(basis)) / units;
    if (Math.abs(ratio - 1) <= tol) inside += 1;
  }
  return { inside, total };
}
