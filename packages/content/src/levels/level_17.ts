import { SIGNALS, signalReading, signalTrades, signalsVisible, type LevelSpec, type QuizQuestion, type Signal, type State } from "@desk/engine";
import { P, hour, isOpen, quizAnswers, refFor, usd, varInsideEveryClose, TIER4_LIMITS, TIER4_UNLOCKS } from "../bot";
import { askMentorTier4, tier4Mentor } from "../mentor";

const SIZE: Record<string, number> = { BRENT: 100, ULSD: 40, TTF: 100 };
const HOLD_AFTER_HEADLINE_HOURS = 72;

const feedOn = (s: State): "pending" | "done" | "failed" => (s.feedBought ? "done" : s.level.status === "running" ? "pending" : "failed");
const tradedTwo = (s: State): "pending" | "done" | "failed" => { const n = signalTrades(s).filter((x) => x.fills.length > 0).length; return n >= 2 ? "done" : s.level.status === "running" ? "pending" : "failed"; };
const flatAtEnd = (s: State): "pending" | "done" | "failed" => (s.level.status === "running" ? "pending" : s.lots.some((l) => l.tag === "signal") ? "failed" : "done");
const profit = (s: State): "pending" | "done" | "failed" => (s.level.status === "running" ? (s.pnl.total > 0 ? "done" : "pending") : s.pnl.total > 0 ? "done" : "failed");

function headlineOf(s: State, sig: Signal) { return s.news.find((n) => n.eventId === sig.eventId); }

function quiz(s: State): QuizQuestion[] {
  const rumours = s.news.filter((n) => n.source === "rumour");
  const trueOnes = rumours.filter((n) => n.resolved?.outcome === "true").length;
  const kinds = ["Hormuz transits a day", "Tankers at anchor off Fujairah", "Satellite hotspots over Jamnagar", "The EU heating-degree-day forecast"];
  return [
    { id: "q1", text: "Which series moved before the Hormuz headline?", choices: kinds, correct: 0, explanation: "Owners hold back before any passage is officially restricted; the count fell for days first." },
    { id: "q2", text: "Which series moved before the Jamnagar fire headline, and by how much warning?", choices: ["The transit count, a week", "The hotspot feed, two ticks before the fire and a day and a half before the wire", "The cold forecast, a month", "None"], correct: 1, explanation: "A hotspot is heat, and the wire arrived 36 hours after the world moved." },
    { id: "q3", text: `${rumours.length} rumours reached the screen this level and ${trueOnes} turned out true. The base rate you should trade on is:`, choices: ["Every rumour is true", "About half: trade the series that moves the world, fade the story that moves the price", "None are true", "The one the mentor liked"], correct: 1, explanation: "A rumour moves the price and resolves; a signal moves the world and the price catches up. The feed is worth the fee only for the second kind." },
    { id: "q4", text: "A transit count falling cannot tell you:", choices: ["That fewer ships passed", "Whether it is weather, fear or a closure, or how long it lasts", "The day it fell", "The baseline"], correct: 1, explanation: "It is a count. The headline says why, later. Size the trade for the chance it was weather." },
  ];
}

export const level17: LevelSpec = {
  id: 17, tier: 4, title: "Signals", subtitle: "A cluster off Fujairah, Hormuz transits falling, a hotspot at Jamnagar, a cold forecast: trade before the headline",
  days: 45, startDate: "2027-09-06", capital: 50e6, creditLine: 400e6, lives: 3,
  instruments: ["BRENT", "WTI", "DUBAI", "ULSD", "TTF"], unlocks: TIER4_UNLOCKS, infoDelayHours: 36, backMonthDepth: 0.5,
  regime: "normal", world: { oecdInvGap: -5, crudeBalance: 0, geo: 0.3, gasStorageGap: { us: 0, eu: -3 } }, factors: { brentRef: refFor(80, -5, 0.3), ttfRef: 34 },
  limits: { var95: 3e6, netLots: TIER4_LIMITS({ BRENT: 600, WTI: 300, DUBAI: 300, ULSD: 200, TTF: 400 }), grossLots: 1500, stopLoss: 6e6, drawdown: 8e6, concentration: 50 },
  events: [
    { id: "inv1", kind: "inventory_release", day: 2, hour: 14 },
    { id: "r1", kind: "rumour", day: 6, hour: 10, params: { headline: "Rumour: OPEC+ to hold an emergency meeting on a cut", moveNow: 0.012, resolveHours: 48, pTrue: 0.5, eventKind: "balance_shift", eventParams: "{\"kbd\":-400,\"headline\":\"OPEC+ confirms an emergency 400 kb/d cut\"}" } },
    { id: "cluster", kind: "inventory_shock", day: 8, hour: 9, params: { oecdInvGap: 20, signal: "tanker_cluster", headline: "Unsold Gulf crude: a dozen laden VLCCs at anchor off Fujairah", body: "Asian refiners have stepped back and the barrels are waiting on the water. The prompt softens and the structure weakens for weeks." } },
    { id: "inv2", kind: "inventory_release", day: 9, hour: 14 },
    { id: "hormuz", kind: "chokepoint", day: 14, hour: 9, params: { id: "HORMUZ", status: "restricted", signal: "transits", headline: "Hormuz: naval escorts imposed, transits restricted" } },
    { id: "inv3", kind: "inventory_release", day: 16, hour: 14 },
    { id: "r2", kind: "rumour", day: 18, hour: 11, params: { headline: "Rumour: Hormuz convoys suspended after an incident", moveNow: 0.015, resolveHours: 36, pTrue: 0.5, eventKind: "geo_scare", eventParams: "{\"geo\":0.2,\"headline\":\"Convoys suspended: Hormuz traffic halts for a day\"}" } },
    { id: "fire", kind: "refinery_fire", day: 22, hour: 11, params: { days: 10, signal: "hotspot" } },
    { id: "inv4", kind: "inventory_release", day: 23, hour: 14 },
    { id: "reopen", kind: "chokepoint", day: 24, hour: 9, params: { id: "HORMUZ", status: "open", headline: "Hormuz escorts stood down; transits normal" } },
    { id: "cold", kind: "cold_snap", day: 30, hour: 9, params: { hdd: 6, days: 6, signal: "cold_forecast", headline: "An early cold snap settles over north-west Europe" } },
    { id: "inv5", kind: "inventory_release", day: 30, hour: 14 },
    { id: "r3", kind: "rumour", day: 36, hour: 10, params: { headline: "Rumour: Jamnagar crude unit back early", moveNow: -0.005, resolveHours: 48, pTrue: 0.5, eventKind: "grade_diff_shock", eventParams: "{\"grade\":\"BASRAH_MEDIUM\",\"delta\":0.5,\"headline\":\"Jamnagar restarts early: sour crude demand returns\"}" } },
    { id: "inv6", kind: "inventory_release", day: 37, hour: 14 },
  ],
  briefing: `Forty-five days in which the news is late and a quarter of it is rumour. The feed costs ${usd(SIGNALS.feedCostUsd.value)}: four series that move before the headlines do. Tankers gathering at anchor off Fujairah, the Hormuz transit count, satellite hotspots over Jamnagar, the European cold forecast. Each has a baseline and a scatter; one reading off the line is noise, two are a question, three are a signal.

Trade the series, not the story: tag the order "signal" on the ticket, size it as a view inside a $3m VaR, and be out a few days after the headline. Every rumour resolves on screen; count how many were true.

Pass: the feed bought, two positions taken on a signal before its headline, nothing tagged signal left on the book at the end, profitable, VaR inside the limit.`,
  objectives: [
    { id: "feed", text: "The feed bought", check: feedOn },
    { id: "two", text: "Two positions taken on a signal before its headline", check: tradedTwo, detail: (s) => `${signalTrades(s).filter((x) => x.fills.length > 0).length} signals traded in their window` },
    { id: "flat", text: "No signal position left at the end", check: flatAtEnd },
    { id: "profit", text: "Profitable", check: profit, detail: (s) => `P&L ${usd(s.pnl.total)}` },
    { id: "var", text: "VaR inside the limit at every close", check: varInsideEveryClose },
  ],
  cards: [
    { id: "lags", trigger: () => true },
    { id: "signal_vs_noise", trigger: (s) => s.feedBought },
    { id: "transit_count", trigger: (s) => s.signals.some((x) => x.kind === "transits" && signalReading(x).off) || s.chokepoints.HORMUZ.status !== "open" },
  ],
  mentor: (s, ev) => {
    const lines = tier4Mentor(s, ev);
    if (s.tick === 0 && ev.length === 0) lines.push("The wire is thirty-six hours behind the world this month and a quarter of it is invented. Buy the feed on Intel. Then watch the series, not the headlines.");
    if (ev.some((e) => e.kind === "signal" && e.text.startsWith("Signal:"))) lines.push("A reading off its baseline. One is noise. If the next one agrees, that is a position, sized for the chance it was weather.");
    if (ev.some((e) => e.kind === "rumour")) lines.push("A rumour. The price moved; the world did not, yet. Check whether any series agrees before you believe it.");
    return lines;
  },
  askMentor: askMentorTier4,
  pass: (s) => feedOn(s) === "done" && tradedTwo(s) === "done" && flatAtEnd(s) === "done" && s.pnl.total > 0 && varInsideEveryClose(s) === "done",
  passRuleText: "Feed bought, two signals traded before their headlines, flat of signal positions at the end, profitable, VaR inside at every close, and a correct debrief.",
  quiz,
  par: 159557.32, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
  seeds: [1, 2, 3, 4, 5, 6, 8, 9, 10, 11],
  solve: (s) => {
    if (s.level.status === "ended") return quizAnswers(s);
    if (s.level.status !== "running") return [];
    if (!s.feedBought) return [{ type: "buy_feed", player: P }];
    if (!isOpen(s) || hour(s) < 8 || hour(s) > 16) return [];
    for (const sig of signalsVisible(s)) {
      const lots = s.lots.filter((l) => l.tag === "signal" && l.inst === sig.inst);
      const held = lots.reduce((a, l) => a + l.qty, 0);
      const headline = headlineOf(s, sig);
      // out a few days after the headline, each lot in its own month
      if (held !== 0 && headline && s.tick >= headline.tick + HOLD_AFTER_HEADLINE_HOURS) return [{ type: "order", player: P, inst: sig.inst, month: lots[0].month, side: lots[0].qty > 0 ? "sell" : "buy", qty: Math.abs(lots[0].qty), kind: "market", tag: "signal" }];
      if (held !== 0 || headline) continue;
      // in when two consecutive readings (one, for the hourly hotspot feed) are off the baseline the right way
      const pts = sig.series.slice(-2);
      const offRight = (v: number) => (sig.direction === "up" ? (sig.kind === "transits" ? v < sig.baseline - 12 : v > sig.baseline + 2.5) : v < sig.baseline - 3 || (sig.kind === "tanker_cluster" && v > sig.baseline + 3));
      const need = sig.cadenceHours === 1 ? 1 : 2;
      if (pts.length >= need && pts.slice(-need).every((p) => offRight(p.v)) && s.tick - pts[pts.length - 1].tick < 24) {
        return [{ type: "order", player: P, inst: sig.inst, month: s.listed[sig.inst][1], side: sig.direction === "up" ? "buy" : "sell", qty: SIZE[sig.inst] ?? 50, kind: "market", tag: "signal" }];
      }
    }
    return [];
  },
};
