import { type EventSchedule, type LevelSpec, type QuizQuestion, type State } from "@desk/engine";
import { refFor, usd, TIER4_LIMITS, TIER4_UNLOCKS } from "../bot";
import { genericTrade } from "../generic";
import { askMentorTier4 } from "../mentor";

const CEILING = 365;
const BOT_END_DAY = 90;
const noLife = (s: State): "pending" | "done" | "failed" => (s.risk.livesLost > 0 ? "failed" : s.level.status === "running" ? "pending" : "done");
const profit = (s: State): "pending" | "done" | "failed" => (s.level.status === "running" ? (s.pnl.total > 0 ? "done" : "pending") : s.pnl.total > 0 ? "done" : "failed");
const noForced = (s: State): "pending" | "done" | "failed" => (s.risk.forcedReductions > 0 ? "failed" : s.level.status === "running" ? "pending" : "done");

/** A year of tender flow, repeating every 30 days with the names rotating: cheap and dear offers, bids a week or two behind. */
const T = (id: string, day: number, hour: number, p: Record<string, number | string | boolean>): EventSchedule => ({ id, kind: "tender", day, hour, params: p });
function cycle(k: number): EventSchedule[] {
  const d0 = k * 30;
  const odd = k % 2 === 1;
  return [
    T(`o${k}a`, d0 + 1, 9, { counterparty: odd ? "STELLAR" : "NORTHSEA_MAJOR", side: "offer", grade: "FORTIES", bbl: 600000, incoterm: "FOB", port: "SULLOM_VOE", basis: "DATED", windowKind: "after_bl", windowDays: 5, laycanStart: d0 + 6, laycanDays: 2, openHours: 48, diffVsFair: odd ? 0.15 : -0.7 }),
    T(`b${k}a`, d0 + 8, 10, { counterparty: "RHINE_REFINING", side: "bid", grade: "FORTIES", bbl: 600000, incoterm: "CIF", port: "ROTTERDAM", basis: "DATED", windowKind: "after_discharge", windowDays: 5, laycanStart: d0 + 13, laycanDays: 4, openHours: 72, diffVsFair: 0.1 }),
    T(`o${k}b`, d0 + 5, 9, { counterparty: odd ? "VANTAGE" : "DELTA_INDEPENDENT", side: "offer", grade: "BONNY_LIGHT", bbl: 1000000, incoterm: "FOB", port: "BONNY", basis: "DATED", windowKind: odd ? "month_avg_offset" : "after_bl", offsetMonths: 1, windowDays: 5, laycanStart: d0 + 11, laycanDays: 2, openHours: 60, diffVsFair: odd ? -0.8 : -0.75 }),
    T(`b${k}b`, d0 + 14, 10, { counterparty: odd ? "ADRIATIC_SMALL" : "STELLAR", side: "bid", grade: "BONNY_LIGHT", bbl: 1000000, incoterm: "CIF", port: "ROTTERDAM", basis: "DATED", windowKind: "after_discharge", windowDays: 5, laycanStart: d0 + 27, laycanDays: 5, openHours: 72, diffVsFair: odd ? 0.5 : 0.1 }),
    T(`o${k}c`, d0 + 12, 9, { counterparty: "GULF_NATIONAL", side: "offer", grade: "ARAB_LIGHT", bbl: 2000000, incoterm: "FOB", port: "RAS_TANURA", basis: "DUBAI", windowKind: "after_bl", windowDays: 5, laycanStart: d0 + 18, laycanDays: 2, openHours: 60, diffVsFair: odd ? -0.45 : -0.65, requiresLc: !odd }),
    T(`b${k}c`, d0 + 22, 10, { counterparty: "EASTERN_PACIFIC", side: "bid", grade: "ARAB_LIGHT", bbl: 2000000, incoterm: "DES", port: "NINGBO", basis: "DUBAI", windowKind: "after_discharge", windowDays: 5, laycanStart: d0 + 42, laycanDays: 8, openHours: 72, diffVsFair: 0.1 }),
    T(`o${k}d`, d0 + 20, 9, { counterparty: "GULF_COAST_REFINING", side: "offer", grade: "WTI_MIDLAND", bbl: 600000, incoterm: "FOB", port: "CORPUS_CHRISTI", basis: "WTI", windowKind: "after_bl", windowDays: 5, laycanStart: d0 + 26, laycanDays: 2, openHours: 48, diffVsFair: odd ? -0.6 : 0.1 }),
    T(`b${k}d`, d0 + 29, 10, { counterparty: "RHINE_REFINING", side: "bid", grade: "WTI_MIDLAND", bbl: 600000, incoterm: "CIF", port: "ROTTERDAM", basis: "DATED", windowKind: "after_discharge", windowDays: 5, laycanStart: d0 + 44, laycanDays: 5, openHours: 72, diffVsFair: 0.1 }),
  ];
}
const flow: EventSchedule[] = Array.from({ length: 12 }, (_, k) => cycle(k)).flat();
const stress: EventSchedule[] = Array.from({ length: 12 }, (_, k) => [
  // a scare a month, alternating ways, that fades: the regime turns stressed for days, not for good
  { id: `scare${k}`, kind: "headline_move", day: k * 30 + 16, hour: 11, params: { pct: k % 2 === 0 ? 0.04 : -0.04, geo: k % 2 === 0 ? 0.25 : 0.1, headline: k % 2 === 0 ? "Drone strike on a Gulf export terminal; vol jumps and depth halves" : "Ceasefire talks; the risk premium comes out in an hour" } },
  { id: `rum${k}`, kind: "rumour", day: k * 30 + 24, hour: 10, params: { headline: "Rumour: a supply disruption", moveNow: 0.012, resolveHours: 48, pTrue: 0.5, eventKind: "field_outage", eventParams: "{\"kbd\":300}" } },
  { id: `inv${k}a`, kind: "inventory_release", day: k * 30 + 2, hour: 14 }, { id: `inv${k}b`, kind: "inventory_release", day: k * 30 + 9, hour: 14 }, { id: `inv${k}c`, kind: "inventory_release", day: k * 30 + 16, hour: 14 }, { id: `inv${k}d`, kind: "inventory_release", day: k * 30 + 23, hour: 14 },
] as EventSchedule[]).flat();

function quiz(s: State): QuizQuestion[] {
  const against = s.tenders.filter((t) => t.trap && /against you/.test(t.trap)).length;
  return [
    { id: "q1", text: `${against} tenders this run were priced against a position you were known to hold. The defence is:`, choices: ["Trade more", "Show less: sell before the market knows you must, hedge in the liquid month, and never be the only buyer of what you own", "Complain", "Ignore it"], correct: 1, explanation: "A known position is a price. Partner is the level where the market knows yours." },
    { id: "q2", text: "When depth halved in stress, the right size was:", choices: ["The same", "Half, decided before the stress: the exit is what you can sell into a thin book", "Double", "Zero"], correct: 1, explanation: "Liquidity is a regime. Size for the exit, not the entry." },
    { id: "q3", text: "This level is endless and scored against your own past runs. The number that matters most is:", choices: ["The biggest P&L once", "The P&L you can repeat on a fresh seed inside the limits every time", "The rank", "The number of cargoes"], correct: 1, explanation: "A fresh seed every run is the point: repeatable process beats one lucky quarter." },
  ];
}

export const level20: LevelSpec = {
  id: 20, tier: 5, title: "Partner", subtitle: "Adversarial and endless: liquidity halves in stress, counterparties price your known positions against you, a fresh seed every run, a leaderboard against your own past runs",
  days: CEILING, startDate: "2027-10-04", capital: 50e6, creditLine: 400e6, lives: 3,
  instruments: ["BRENT", "WTI", "DUBAI", "RBOB", "ULSD", "HH", "TTF", "JKM"], unlocks: TIER4_UNLOCKS, infoDelayHours: 36, backMonthDepth: 0.5, stressDepth: 0.5, adversarial: true, freshSeed: true, endless: true, mentorSilent: true,
  regime: "normal", world: { oecdInvGap: 8, crudeBalance: 0, geo: 0.35 }, factors: { brentRef: refFor(75, 8, 0.35) },
  limits: { var95: 5e6, netLots: TIER4_LIMITS({ BRENT: 2500, WTI: 1500, DUBAI: 2500, RBOB: 500, ULSD: 500, HH: 300, TTF: 300, JKM: 300 }), grossLots: 7000, stopLoss: 10e6, drawdown: 12e6, concentration: 50 },
  events: [...flow, ...stress],
  briefing: `Partner. The level runs until you end it from the Bridge, on a fresh seed every time, and the leaderboard is your own past runs. Depth halves whenever the regime is stressed, and every counterparty prices what it knows you hold against you: a bid for a grade you are long of comes twenty cents cheaper, an offer to a book that is long the benchmark comes fifteen cents dearer. The tender flow repeats every month with the names rotating; a scare lands mid-month, a rumour late in it.

The solution bot ends its run on day ${BOT_END_DAY}; its P&L on your seed is the par. Pass: profitable when you end it, no life lost, no forced reduction. Sandbox mode is on the Academy: any level, any seed, any knob, no score.`,
  objectives: [
    { id: "profit", text: "Profitable when you end it", check: profit, detail: (s) => `P&L ${usd(s.pnl.total)}` },
    { id: "forced", text: "No forced reduction", check: noForced },
    { id: "lives", text: "No life lost", check: noLife },
  ],
  cards: [],
  askMentor: askMentorTier4,
  pass: (s) => profit(s) === "done" && noForced(s) === "done" && noLife(s) === "done",
  passRuleText: "Profitable when you end it, no forced reduction, no life lost, and a correct debrief. The par is the solution bot's P&L on your seed, ending on day 90.",
  quiz,
  par: 1505445.64, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
  seeds: [1, 3, 5, 6, 7, 8, 9, 10, 11, 12],
  solve: (s) => genericTrade(s, { minEdge: 0.4, maxCargoes: 2, endDay: BOT_END_DAY, sellTol: 0.35 }),
};
