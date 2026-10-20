import type { LevelSpec, QuizQuestion, State } from "@desk/engine";
import { P, buy, flatten, front, hour, isOpen, levelDay, net, noMarginCall, positivePnl, quizAnswers, refFor, usd, varInsideEveryClose, TIER1_LIMITS_NONE, TIER1_UNLOCKS } from "../bot";
import { askMentorTier1, tier1Mentor } from "../mentor";

const GAP = -28; // mb: stocks are drawing; the desk's model says fair value is above the screen

function quiz(s: State): QuizQuestion[] {
  const vm = s.finance.ledger.filter((r) => r.kind === "variation_margin");
  const worst = vm.reduce((a, r) => (r.amount < a.amount ? r : a), vm[0] ?? { amount: 0, tick: 0 });
  const v = s.risk.var95?.v ?? 0;
  return [
    { id: "q1", text: `Your worst settle moved ${usd(worst.amount)} of variation margin. What is variation margin?`, choices: ["A deposit the clearer holds until you close", "The day's P&L paid or received in cash at the settle", "A fee for crossing the spread", "The interest on the credit line"], correct: 1, explanation: "Variation margin is the day's mark-to-market P&L settled in cash. The deposit is initial margin." },
    { id: "q2", text: `Your VaR limit was ${usd(s.risk.limits.var95)}. Which order of decisions does the desk want?`, choices: ["Direction first, then as many lots as the line allows", "Size to the limit first, then choose direction", "Size to the margin, then direction", "Direction, then add lots while winning"], correct: 1, explanation: "Size before direction: the limit is the budget; the view is how you spend it. A book sized to the line survives nothing." },
    { id: "q3", text: `On day 3 a headline dropped the prompt about 2.5% and the report was denied the next day. A position sized so that margin used the whole line would have:`, choices: ["Lost 2.5% of capital and recovered", "Received a margin call at the close and been liquidated at the touch if unmet", "Been unaffected: the clearer waits for the denial", "Paid more interest but nothing else"], correct: 1, explanation: "Variation margin leaves your account at the settle. With the line fully used for initial margin there is no cash; the clearer calls, then liquidates at the touch." },
    { id: "q4", text: `At the last close your VaR was ${usd(v)}. VaR at 95% means:`, choices: ["The most you can lose in a day", "The loss not exceeded on 95% of simulated days", "The average daily loss", "Initial margin times two"], correct: 1, explanation: "VaR is a quantile, not a maximum: one day in twenty loses more than it." },
  ];
}

export const level01: LevelSpec = {
  id: 1, tier: 1, title: "Flat price and margin", subtitle: "Hold through settles; variation margin moves cash; a stop-loss",
  days: 10, startDate: "2027-01-04", capital: 5e6, creditLine: 20e6, lives: 3,
  instruments: ["BRENT"], unlocks: TIER1_UNLOCKS,
  regime: "calm", world: { oecdInvGap: GAP, crudeBalance: -500, targets: { crudeBalance: -500 } }, prehistoryWorld: { oecdInvGap: 0 }, factors: { brentRef: refFor(75, 0) },
  limits: { var95: 150000, netLots: { ...TIER1_LIMITS_NONE, BRENT: 150 }, grossLots: 300, stopLoss: 500000, drawdown: 600000, concentration: 1 },
  events: [
    { id: "rumour", kind: "headline_move", day: 3, hour: 10, params: { pct: -0.025, headline: "Report: OPEC+ weighing an output increase; prompt drops", body: "An unsourced report. The prompt falls 2.5% in the hour. Nothing in the balance has changed yet." } },
    { id: "denial", kind: "headline_move", day: 4, hour: 9, params: { pct: 0.0256, headline: "OPEC+ denies the increase report; prompt recovers", body: "The secretariat calls yesterday's report baseless. The move unwinds." } },
  ],
  briefing: `Ten days, Brent only, calm market. Stocks are drawing: the desk's fundamental model has fair value above the screen (hover "Desk view" on the Bridge). Your VaR limit is $150,000 a day.

Hold a position through settles and watch variation margin move your cash. Size it to the limit, not to the line: a book that uses the whole line for margin gets a margin call on the first bad day. Put a stop-loss order under it if you cannot watch the screen.

Pass: positive P&L, no margin call, VaR inside the limit at every close.`,
  objectives: [
    { id: "pnl", text: "Finish with positive P&L", check: positivePnl },
    { id: "margin", text: "No margin call", check: noMarginCall },
    { id: "var", text: "VaR inside the limit at every close", check: varInsideEveryClose, detail: (s) => `${s.risk.closesInsideLimit} of ${s.risk.closesTotal} closes inside` },
  ],
  cards: [
    { id: "size_before_direction", trigger: () => true },
    { id: "initial_variation_margin", trigger: (s) => s.fills.length >= 1 },
    { id: "mark_to_market", trigger: (s) => s.lots.length > 0 && s.risk.closesTotal >= 1 },
  ],
  mentor: (s, ev) => {
    const lines = tier1Mentor(s, ev);
    if (s.tick === 0 && ev.length === 0) lines.push("Ten days. The model says fair value is above the screen. That is a view, not a size. Read the VaR before you add a single lot.");
    if (ev.some((e) => e.kind === "event" && e.text.includes("weighing"))) lines.push("A headline, unsourced. Your model did not move. Your margin did. Which one do you trust?");
    return lines;
  },
  askMentor: askMentorTier1,
  pass: (s) => s.pnl.total > 0 && s.finance.marginCalls === 0 && !s.risk.varBreachedAtClose,
  passRuleText: "Positive P&L, no margin call, VaR inside the limit at every close.",
  quiz,
  par: 102619, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
  seeds: [1, 2, 3, 5, 6, 7, 8, 9, 10, 11],
  solve: (s) => {
    if (s.level.status === "ended") return quizAnswers(s);
    if (s.level.status !== "running") return [];
    const d = levelDay(s), h = hour(s);
    const f = front(s);
    // size before direction: probe with ten lots, read the VaR, scale to 75% of the limit
    if (s.tick === 1) return [buy("BRENT", f, 10)];
    if (s.tick === 2 && s.risk.var95 && s.risk.var95.v > 0) {
      const perLot = s.risk.var95.v / 10;
      const target = Math.min(s.risk.limits.netLots.BRENT, Math.floor((0.75 * s.risk.limits.var95) / perLot));
      const add = target - net(s, "BRENT");
      return add > 0 ? [buy("BRENT", f, add)] : [];
    }
    // book it: once the level's P&L is two-thirds of the daily limit, go flat and stay flat
    if (s.lots.length > 0 && s.pnl.total >= 100000 && isOpen(s)) return flatten(s);
    // flat before the last close
    if (d === 9 && h === 16) return flatten(s);
    return [];
  },
};
