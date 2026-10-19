import type { LevelSpec, QuizQuestion, State } from "@desk/engine";
import { P, buy, flatten, front, gross, hour, levelDay, net, quizAnswers, refFor, sell, usd, TIER1_LIMITS_NONE, TIER1_UNLOCKS } from "../bot";
import { askMentorTier1, tier1Mentor } from "../mentor";

const RELEASE_LIMIT = 30; // lots: the most you may carry into a scheduled release
const RELEASE_DAYS = [2, 9, 16]; // Wednesdays
const MEETING_DAY = 11;

/** Gross lots at the tick of each scheduled release, for the objective. */
function intoReleases(s: State): { tick: number; gross: number }[] {
  const ticks = s.releases.filter((r) => r.name !== "Positioning report").map((r) => r.tick);
  return ticks.filter((t) => t <= s.tick).map((t) => {
    const point = s.pnl.equityCurve.find((p) => p.tick === t - 1);
    void point;
    return { tick: t, gross: grossAt(s, t) };
  });
}
function grossAt(s: State, t: number): number {
  // reconstruct from fills: net by contract at tick t-1 (before the release tick's own fills)
  const by = new Map<string, number>();
  for (const f of s.fills) if (f.tick < t) by.set(`${f.inst}:${f.month}`, (by.get(`${f.inst}:${f.month}`) ?? 0) + (f.side === "buy" ? f.qty : -f.qty));
  let g = 0;
  for (const v of by.values()) g += Math.abs(v);
  return g;
}
const releaseDiscipline = (s: State): "pending" | "done" | "failed" => {
  const seen = intoReleases(s);
  if (seen.some((x) => x.gross > RELEASE_LIMIT)) return "failed";
  return seen.length >= 3 ? "done" : "pending";
};

function quiz(s: State): QuizQuestion[] {
  const rel = s.releases.filter((r) => r.name === "Weekly crude inventories" && r.published && r.actual && r.consensus);
  const big = rel.reduce((a, r) => (Math.abs(r.actual!.v - r.consensus!.v) > Math.abs((a?.actual?.v ?? 0) - (a?.consensus?.v ?? 0)) ? r : a), rel[0]);
  const leak = s.news.find((n) => n.source === "leak");
  return [
    { id: "q1", text: big ? `The biggest surprise was ${big.actual!.v >= 0 ? "+" : ""}${big.actual!.v.toFixed(1)} mb against ${big.consensus!.v >= 0 ? "+" : ""}${big.consensus!.v.toFixed(1)} expected. What moved the price?` : "What moves the price at a release?", choices: ["The actual number", "The surprise: actual minus consensus", "The consensus", "The time of day"], correct: 1, explanation: "The consensus is already in the price before the print; only the surprise reprices." },
    { id: "q2", text: leak ? `The leak said "${leak.headline.replace("Sources: ", "")}" and was resolved ${leak.resolved?.outcome ?? "pending"}. Leaks of this kind are right about:` : "Leaks before an OPEC+ meeting are right about:", choices: ["Always", "Two times in three", "Half the time", "Never"], correct: 1, explanation: "About two in three. The price pays for most of that before the meeting; the residual is the trade, and it is small." },
    { id: "q3", text: "The positioning report showed a crowded long. The right reading was:", choices: ["Buy: everyone is long for a reason", "A tail risk: the exits are narrow if the prompt turns", "Ignore it", "A signal the price will rise next week"], correct: 1, explanation: "A crowded position has already been bought; it needs new buyers to rise and has many sellers when it falls." },
    { id: "q4", text: `Into each release you were allowed ${RELEASE_LIMIT} lots. Why a release limit?`, choices: ["Because the exchange closes", "Because the move at the print can be a week's range in a minute and the risk manager sizes for the surprise", "Because liquidity is best then", "Because the mentor says so"], correct: 1, explanation: "A release is a scheduled jump; a position into it is a bet on the surprise. Size for that or be flat." },
  ];
}

export const level04: LevelSpec = {
  id: 4, tier: 1, title: "Information", subtitle: "The release calendar: consensus and actual, a leak, positioning",
  days: 19, startDate: "2027-01-04", capital: 5e6, creditLine: 20e6, lives: 3,
  instruments: ["BRENT"], unlocks: TIER1_UNLOCKS,
  regime: "calm", world: { oecdInvGap: -12, crudeBalance: -400, targets: { crudeBalance: -400 } }, prehistoryWorld: { oecdInvGap: 0 }, factors: { brentRef: refFor(75, 0) },
  limits: { var95: 150000, netLots: { ...TIER1_LIMITS_NONE, BRENT: 120 }, grossLots: 240, stopLoss: 500000, drawdown: 600000, concentration: 1 },
  events: [
    { id: "eia1", kind: "inventory_release", day: RELEASE_DAYS[0], hour: 15 },
    { id: "pos1", kind: "positioning_report", day: 4, hour: 20, params: { crowded: true } },
    { id: "unwind", kind: "headline_move", day: 7, hour: 10, params: { pct: -0.035, headline: "Funds liquidate: the crowded long unwinds", body: "No new news. The longs that were already in are leaving at once, and the exits are narrow." } },
    { id: "eia2", kind: "inventory_release", day: RELEASE_DAYS[1], hour: 15 },
    { id: "opec", kind: "opec_meeting", day: MEETING_DAY, hour: 11, params: { decision: "hold", kbd: 500, leakTruthful: false } },
    { id: "pos2", kind: "positioning_report", day: 11, hour: 20 },
    { id: "eia3", kind: "inventory_release", day: RELEASE_DAYS[2], hour: 15 },
    { id: "pos3", kind: "positioning_report", day: 18, hour: 20 },
  ],
  briefing: `Nineteen days, Brent only. The calendar on Intel has three Wednesday inventory releases (15:00, consensus shown on the day), an OPEC+ meeting on the second Friday with the usual leak the day before, and Friday positioning reports.

The rule this level: no more than ${RELEASE_LIMIT} lots into any scheduled release or the meeting. Trade the surprise after the print if you like; do not sit in front of it. Read positioning as a crowd. Treat the leak as a base rate: two in three are right, and the price has already paid for most of that.

Pass: inside the release limit every time, and a correct debrief on what was priced and what happened.`,
  objectives: [
    { id: "release_limit", text: `No more than ${RELEASE_LIMIT} lots into any inventory release or the OPEC+ meeting`, check: releaseDiscipline, detail: (s) => intoReleases(s).map((x) => `${x.gross} lots`).join(", ") || "no release yet" },
    { id: "traded", text: "Take at least one position between releases", check: (s) => (s.fills.length > 0 ? "done" : "pending") },
    { id: "var", text: "VaR inside the limit at every close", check: (s) => (s.risk.varBreachedAtClose ? "failed" : s.risk.closesTotal > 0 ? "done" : "pending") },
  ],
  cards: [
    { id: "expected_vs_actual", trigger: () => true },
    { id: "positioning_is_a_crowd", trigger: (s) => s.news.some((n) => n.headline.startsWith("Managed money")) },
    { id: "rumour_base_rate", trigger: (s) => s.news.some((n) => n.source === "leak") },
  ],
  mentor: (s, ev) => {
    const lines = tier1Mentor(s, ev);
    if (s.tick === 0 && ev.length === 0) lines.push("Three prints, one meeting, one leak. The number is not the trade; the surprise is. And a crowd is a crowd.");
    if (ev.some((e) => e.text.startsWith("Managed money") && e.text.includes("4"))) lines.push("Four hundred thousand lots long. Who is left to buy? Think about the exits.");
    if (ev.some((e) => e.text.startsWith("Funds liquidate"))) lines.push("No news. Just the crowd leaving. That is what the positioning report was for.");
    return lines;
  },
  askMentor: askMentorTier1,
  pass: (s) => releaseDiscipline(s) === "done" && !s.risk.varBreachedAtClose,
  passRuleText: `At most ${RELEASE_LIMIT} lots into every release and the meeting, VaR inside the limit, and a correct debrief.`,
  quiz,
  par: 97680, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
  seeds: [1, 2, 3, 4, 6, 7, 8, 9, 11, 12],
  solve: (s) => {
    if (s.level.status === "ended") return quizAnswers(s);
    if (s.level.status !== "running") return [];
    const d = levelDay(s), h = hour(s);
    const f = front(s);
    const flatBefore = (day: number, hr: number) => d === day && h === hr - 1 && gross(s) > 0;
    // flat into every print and the meeting
    for (const rd of RELEASE_DAYS) if (flatBefore(rd, 15)) return flatten(s);
    if (flatBefore(MEETING_DAY, 11)) return flatten(s);
    // the desk is bullish between events: a modest long, re-opened after each print
    if (d === 2 && h === 16) return [buy("BRENT", f, 40)];
    // the crowded print on Friday evening: on Monday morning flatten, then short into the unwind, cover after it
    if (d === 7 && h === 1 && net(s, "BRENT") > 0) return flatten(s);
    if (d === 7 && h === 2 && net(s, "BRENT") === 0) return [sell("BRENT", f, 40)];
    if (d === 7 && h === 12 && net(s, "BRENT") < 0) return flatten(s);
    if (d === 7 && h === 13 && net(s, "BRENT") === 0) return [buy("BRENT", f, 40)];
    if (d === 9 && h === 16) return [buy("BRENT", f, 40)];
    if (d === 11 && h === 12) return [buy("BRENT", f, 40)];
    if (d === 16 && h === 16) return [buy("BRENT", f, 40)];
    if (d === 18 && h === 16) return flatten(s);
    return [];
  },
};
