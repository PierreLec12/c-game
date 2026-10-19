import type { LevelSpec, State } from "@desk/engine";
import { P, buy, sell, drillAnswers, front, usd, TIER1_LIMITS_NONE } from "../bot";
import { drillSet } from "../drills";
import { askMentorTier1, tier1Mentor } from "../mentor";

const roundTrip = (s: State) => s.fills.some((f) => f.side === "buy") && s.fills.some((f) => f.side === "sell") && s.lots.length === 0;
const drillsRight = (s: State) => s.level.drills.length > 0 && s.level.drills.every((d) => d.correct);

export const level00: LevelSpec = {
  id: 0, tier: 0, title: "Orientation", subtitle: "The clock, the ticker, a quote, the Book",
  days: 1, startDate: "2027-01-04", capital: 5e6, creditLine: 20e6, lives: 3,
  instruments: ["BRENT"],
  unlocks: ["order", "close", "cancel_order", "open_card", "ask_mentor", "answer_drill", "answer_quiz", "end_level"],
  regime: "calm", world: { oecdInvGap: 0 }, factors: { brentRef: 75 },
  limits: { var95: 1e6, netLots: { ...TIER1_LIMITS_NONE, BRENT: 50 }, grossLots: 100, stopLoss: 1e6, drawdown: 1e6, concentration: 1 },
  events: [],
  briefing: `One session. This is the desk: the clock runs an hour a tick, the ticker is the market, the ticket has a bid and an ask, and the Book shows what you own and what it is worth.

Mission: buy one lot of Brent on the Markets screen, watch the mark move for a while, sell it, and read the P&L and its hover. Then answer the six conversion drills on the Bridge. Pass: a round trip and six of six.

Nothing here can hurt you. Hover every number; each one says what it is and where it came from.`,
  objectives: [
    { id: "buy_one", text: "Buy one lot of Brent at market", check: (s) => (s.fills.some((f) => f.side === "buy") ? "done" : "pending") },
    { id: "watch", text: "Hold it for at least an hour and watch the mark move", check: (s) => (s.fills.some((f) => f.side === "buy" && s.tick - f.tick >= 1) ? "done" : "pending") },
    { id: "round_trip", text: "Sell it: one round trip, and read the P&L hover", check: (s) => (roundTrip(s) ? "done" : "pending") },
    { id: "drills", text: "Answer the six conversion drills (6 of 6 to pass; wrong ones may be retried)", check: (s) => (drillsRight(s) ? "done" : "pending"), detail: (s) => `${s.level.drills.filter((d) => d.correct).length} of ${s.level.drills.length} right` },
  ],
  cards: [
    { id: "what_a_lot_is", trigger: () => true },
    { id: "ask_above_bid", trigger: (s) => s.fills.length >= 1 },
    { id: "tick_and_settle", trigger: (s) => roundTrip(s) },
  ],
  mentor: (s, ev) => {
    const lines = tier1Mentor(s, ev);
    if (s.tick === 0 && ev.length === 0) lines.push("Ines Varga here. I will not be cheerful. Buy one lot of Brent, watch it, sell it, then do the drills. Hover anything you do not understand.");
    return lines;
  },
  askMentor: askMentorTier1,
  pass: (s) => roundTrip(s) && drillsRight(s),
  passRuleText: "Six drills right and one round trip.",
  quiz: () => [],
  drills: (seed) => drillSet(seed, ["spread", "pnl", "gal_bbl", "mmbtu_mwh", "tonne_bbl", "hedge_lots"], "level0"),
  par: 0, noPar: true,
  seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  solve: (s) => {
    if (s.level.status !== "running") return [];
    if (s.tick === 1) return [buy("BRENT", front(s), 1), ...drillAnswers(s)];
    if (s.tick === 6) return [sell("BRENT", front(s), 1)];
    if (s.tick === 7) return [{ type: "end_level", player: P }];
    return [];
  },
};

export const level00Summary = (s: State) => `Round trip ${s.fills.length >= 2 ? "done" : "not done"}; P&L ${usd(s.pnl.total)}.`;
