/** Shared helpers for the solution bots and the level checks. */
import { ckey, hourOfTick, type Action, type InstrumentId, type State } from "@desk/engine";

export const P = "p1";
export const front = (s: State, inst: InstrumentId = "BRENT"): string => s.listed[inst][0];
export const second = (s: State, inst: InstrumentId = "BRENT"): string => s.listed[inst][1];
export const levelDay = (s: State): number => Math.floor(s.tick / 24);
export const hour = (s: State): number => hourOfTick(s.tick);
export const at = (s: State, day: number, h: number): boolean => s.tick === day * 24 + h;
export const net = (s: State, inst: InstrumentId, month?: string): number => s.lots.filter((l) => l.inst === inst && (month === undefined || l.month === month)).reduce((a, l) => a + l.qty, 0);
export const gross = (s: State): number => s.lots.reduce((a, l) => a + Math.abs(l.qty), 0);
export const mid = (s: State, inst: InstrumentId, month: string): number => s.quotes[ckey(inst, month)]?.mid ?? 0;
export const isOpen = (s: State): boolean => s.quotes[ckey("BRENT", front(s))]?.open ?? false;

export const buy = (inst: InstrumentId, month: string, qty: number): Action => ({ type: "order", player: P, inst, month, side: "buy", qty, kind: "market" });
export const sell = (inst: InstrumentId, month: string, qty: number): Action => ({ type: "order", player: P, inst, month, side: "sell", qty, kind: "market" });
export const close = (inst: InstrumentId, month: string): Action => ({ type: "close", player: P, inst, month });

export function flatten(s: State): Action[] {
  const seen = new Set<string>();
  const out: Action[] = [];
  for (const l of s.lots) {
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

export function leg(s: State, name: "flat" | "basis" | "time_spread" | "crack" | "fees_slippage" | "fx" | "finance"): number {
  return s.pnl.attribution.filter((r) => r.leg === name).reduce((a, r) => a + r.amount, 0);
}

// ---------------------------------------------------------------- common objective checks
export const varInsideEveryClose = (s: State): "pending" | "done" | "failed" => (s.risk.varBreachedAtClose ? "failed" : s.risk.closesTotal > 0 ? "done" : "pending");
export const noMarginCall = (s: State): "pending" | "done" | "failed" => (s.finance.marginCalls > 0 ? "failed" : s.fills.length > 0 ? "done" : "pending");
export const positivePnl = (s: State): "pending" | "done" | "failed" => (s.level.status === "running" ? (s.pnl.total > 0 ? "done" : "pending") : s.pnl.total > 0 ? "done" : "failed");
export const grossUnderLimitEveryClose = (s: State): "pending" | "done" | "failed" => (s.risk.breaches.some((b) => b.limit === "grossLots") ? "failed" : s.risk.closesTotal > 0 ? "done" : "pending");

export const TIER1_UNLOCKS: Action["type"][] = ["order", "close", "cancel_order", "draw_line", "repay_line", "post_margin", "open_card", "ask_mentor", "answer_drill", "answer_quiz", "end_level", "request_limit"];
export const TIER1_LIMITS_NONE = { BRENT: 0, WTI: 0, RBOB: 0, ULSD: 0, HH: 0, TTF: 0 };
