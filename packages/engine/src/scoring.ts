/**
 * Level score, rank, achievements (section 8).
 *   score = 100 * clamp(pnl / par, -1, 2) + 50 * process - 25 * max_drawdown / capital + 25 * debrief_quiz
 */
import type { LevelSpec } from "./levels";
import type { ScoreCard, State } from "./types";

/** Stylised: the smallest par the score divides by, so a lucky $1 par does not make $10 worth 200 points. */
export const PAR_FLOOR = 10000;

export const RANKS: { name: string; from: number }[] = [
  { name: "Operator", from: 0 }, { name: "Junior Trader", from: 300 }, { name: "Trader", from: 800 },
  { name: "Senior Trader", from: 1500 }, { name: "Book Head", from: 2400 }, { name: "Partner", from: 3200 },
];
export function rankFor(cumulativeScore: number): string {
  let r = RANKS[0].name;
  for (const x of RANKS) if (cumulativeScore >= x.from) r = x.name;
  return r;
}

export function computeScore(state: State, spec: LevelSpec): ScoreCard {
  const pnl = state.pnl.total;
  const par = state.level.par;
  // par 0 means the level has no P&L target (orientation): the P&L component is a flat 100.
  // A par below the floor (the bot barely broke even or lost on this seed) is replaced by the floor so the ratio keeps its meaning.
  // ratio = 1 + (pnl - par) / max(|par|, floor): equals pnl / par when par is above the floor, and still reads
  // "1 = matched the bot" when the bot lost money on this seed (an unhedged cargo level can have a negative par)
  const base = spec.noPar ? 0 : Math.max(Math.abs(par), PAR_FLOOR);
  const ratio = base > 0 ? 1 + (pnl - par) / base : 1;
  const pnlComponent = 100 * Math.max(-1, Math.min(2, ratio));
  const objs = state.level.objectives;
  const process = objs.length ? objs.filter((o) => o.status === "done").length / objs.length : 1;
  const processComponent = 50 * process;
  const maxDrawdown = state.risk.maxDrawdown;
  const drawdownComponent = -25 * (maxDrawdown / state.capital);
  const answered = state.level.quiz.filter((q) => q.given !== undefined);
  const quiz = state.level.quiz.length ? state.level.quiz.filter((q) => q.given === q.correct).length / state.level.quiz.length : 1;
  const quizComponent = 25 * quiz;
  const total = pnlComponent + processComponent + drawdownComponent + quizComponent;
  const quizDone = answered.length === state.level.quiz.length;
  const passed = quizDone && total >= 100 && state.risk.livesLost === 0 && spec.pass(state);
  const achievements: string[] = [];
  if (state.fills.length >= 2 && state.lots.length === 0) achievements.push("Round trip");
  if (state.finance.marginCalls === 0 && state.fills.length > 0) achievements.push("Zero margin calls");
  if (state.risk.closesTotal > 0 && state.risk.closesInsideLimit === state.risk.closesTotal) achievements.push("Inside the limit every close");
  if (state.level.quiz.length > 0 && quiz === 1) achievements.push("Read the debrief right");
  if (state.news.some((n) => n.source === "leak" && n.resolved?.outcome === "false") && state.lots.length === 0) achievements.push("Called the rumour false");
  const formula = `100 x clamp(1 + (${fmt(pnl)} - par ${fmt(par)}) / ${fmt(base)}, -1, 2) = ${pnlComponent.toFixed(0)}; + 50 x ${process.toFixed(2)} process = ${processComponent.toFixed(0)}; - 25 x ${fmt(maxDrawdown)} / ${fmt(state.capital)} drawdown = ${drawdownComponent.toFixed(0)}; + 25 x ${quiz.toFixed(2)} quiz = ${quizComponent.toFixed(0)}`;
  return { pnl, par, pnlComponent, process, processComponent, maxDrawdown, drawdownComponent, quiz, quizComponent, total, passed, formula, achievements };
}

function fmt(x: number): string { return (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString(); }
