import { type EventSchedule, type LevelSpec, type QuizQuestion, type State } from "@desk/engine";
import { refFor, usd, varInsideEveryClose, TIER4_LIMITS, TIER4_UNLOCKS } from "../bot";
import { genericTrade } from "../generic";
import { askMentorTier4 } from "../mentor";

const DAYS = 90;
const BUDGET = 1e6;
/** The budget, or, when the solution bot itself fell short of it on this seed, the bot's own result less a little: the market does not offer the budget every quarter. */
const target = (s: State): number => (s.level.par > 0 ? Math.min(BUDGET, s.level.par - 50000) : BUDGET);
const budgetMet = (s: State): "pending" | "done" | "failed" => (s.level.status === "running" ? (s.pnl.total >= target(s) ? "done" : "pending") : s.pnl.total >= target(s) ? "done" : "failed");
const noLife = (s: State): "pending" | "done" | "failed" => (s.risk.livesLost > 0 ? "failed" : s.level.status === "running" ? "pending" : "done");
const noForced = (s: State): "pending" | "done" | "failed" => (s.risk.forcedReductions > 0 ? "failed" : s.level.status === "running" ? "pending" : "done");
const cashOk = (s: State): "pending" | "done" | "failed" => (s.finance.marginCalls > 0 ? "failed" : s.level.status === "running" ? "pending" : "done");

/** The quarter's tender flow: an offer and, a week or two later, a bid for the same grade; some cheap, some dear, some with strings. */
const T = (id: string, day: number, hour: number, p: Record<string, number | string | boolean>): EventSchedule => ({ id, kind: "tender", day, hour, params: p });
const flow: EventSchedule[] = [
  T("o1", 0, 9, { counterparty: "NORTHSEA_MAJOR", side: "offer", grade: "FORTIES", bbl: 600000, incoterm: "FOB", port: "SULLOM_VOE", basis: "DATED", windowKind: "after_bl", windowDays: 5, laycanStart: 5, laycanDays: 2, openHours: 48, diffVsFair: -0.7 }),
  T("b1", 7, 10, { counterparty: "RHINE_REFINING", side: "bid", grade: "FORTIES", bbl: 600000, incoterm: "CIF", port: "ROTTERDAM", basis: "DATED", windowKind: "after_discharge", windowDays: 5, laycanStart: 12, laycanDays: 4, openHours: 72, diffVsFair: 0.1 }),
  T("o2", 3, 9, { counterparty: "DELTA_INDEPENDENT", side: "offer", grade: "BONNY_LIGHT", bbl: 1000000, incoterm: "FOB", port: "BONNY", basis: "DATED", windowKind: "after_bl", windowDays: 5, laycanStart: 9, laycanDays: 2, openHours: 60, diffVsFair: -0.75, prepayDiscount: 0.35 }),
  T("b2", 12, 10, { counterparty: "RHINE_REFINING", side: "bid", grade: "BONNY_LIGHT", bbl: 1000000, incoterm: "CIF", port: "ROTTERDAM", basis: "DATED", windowKind: "after_discharge", windowDays: 5, laycanStart: 26, laycanDays: 5, openHours: 72, diffVsFair: 0.1 }),
  T("o3", 6, 9, { counterparty: "VANTAGE", side: "offer", grade: "ES_SIDER", bbl: 1000000, incoterm: "FOB", port: "ES_SIDER", basis: "DATED", windowKind: "month_avg_offset", offsetMonths: 1, laycanStart: 12, laycanDays: 2, openHours: 48, diffVsFair: -0.9, trap: "A month-average window a month after loading: the cheap differential hides a time spread, and Vantage is rated BB." }),
  T("o4", 10, 9, { counterparty: "GULF_NATIONAL", side: "offer", grade: "ARAB_LIGHT", bbl: 2000000, incoterm: "FOB", port: "RAS_TANURA", basis: "DUBAI", windowKind: "after_bl", windowDays: 5, laycanStart: 16, laycanDays: 2, openHours: 60, diffVsFair: -0.6, requiresLc: true }),
  T("b4", 20, 10, { counterparty: "EASTERN_PACIFIC", side: "bid", grade: "ARAB_LIGHT", bbl: 2000000, incoterm: "DES", port: "NINGBO", basis: "DUBAI", windowKind: "after_discharge", windowDays: 5, laycanStart: 40, laycanDays: 8, openHours: 72, diffVsFair: 0.1 }),
  T("o5", 15, 9, { counterparty: "STELLAR", side: "offer", grade: "FORTIES", bbl: 600000, incoterm: "FOB", port: "SULLOM_VOE", basis: "DATED", windowKind: "after_bl", windowDays: 5, laycanStart: 20, laycanDays: 2, openHours: 48, diffVsFair: 0.2 }),
  T("b5", 22, 10, { counterparty: "ADRIATIC_SMALL", side: "bid", grade: "FORTIES", bbl: 600000, incoterm: "CIF", port: "ROTTERDAM", basis: "DATED", windowKind: "after_discharge", windowDays: 5, laycanStart: 28, laycanDays: 4, openHours: 72, diffVsFair: 0.6, trap: "The best bid on the screen, from the refiner that pays twelve days late and was downgraded last month." }),
  T("o6", 24, 9, { counterparty: "NORTHSEA_MAJOR", side: "offer", grade: "FORTIES", bbl: 600000, incoterm: "FOB", port: "SULLOM_VOE", basis: "DATED", windowKind: "after_bl", windowDays: 5, laycanStart: 30, laycanDays: 2, openHours: 48, diffVsFair: -0.65 }),
  T("b6", 33, 10, { counterparty: "RHINE_REFINING", side: "bid", grade: "FORTIES", bbl: 600000, incoterm: "CIF", port: "ROTTERDAM", basis: "DATED", windowKind: "after_discharge", windowDays: 5, laycanStart: 38, laycanDays: 4, openHours: 72, diffVsFair: 0.1 }),
  T("o7", 30, 9, { counterparty: "DELTA_INDEPENDENT", side: "offer", grade: "BONNY_LIGHT", bbl: 1000000, incoterm: "FOB", port: "BONNY", basis: "DATED", windowKind: "after_bl", windowDays: 5, laycanStart: 36, laycanDays: 2, openHours: 60, diffVsFair: -0.8 }),
  T("b7", 40, 10, { counterparty: "STELLAR", side: "bid", grade: "BONNY_LIGHT", bbl: 1000000, incoterm: "CIF", port: "ROTTERDAM", basis: "DATED", windowKind: "after_discharge", windowDays: 5, laycanStart: 52, laycanDays: 5, openHours: 72, diffVsFair: 0.1 }),
  T("o8", 38, 9, { counterparty: "GULF_COAST_REFINING", side: "offer", grade: "WTI_MIDLAND", bbl: 600000, incoterm: "FOB", port: "CORPUS_CHRISTI", basis: "WTI", windowKind: "after_bl", windowDays: 5, laycanStart: 44, laycanDays: 2, openHours: 48, diffVsFair: -0.65 }),
  T("b8", 47, 10, { counterparty: "RHINE_REFINING", side: "bid", grade: "WTI_MIDLAND", bbl: 600000, incoterm: "CIF", port: "ROTTERDAM", basis: "DATED", windowKind: "after_discharge", windowDays: 5, laycanStart: 62, laycanDays: 5, openHours: 72, diffVsFair: 0.1 }),
  T("o9", 45, 9, { counterparty: "VANTAGE", side: "offer", grade: "URALS", bbl: 600000, incoterm: "FOB", port: "NOVOROSSIYSK", basis: "DATED", windowKind: "after_bl", windowDays: 5, laycanStart: 51, laycanDays: 2, openHours: 48, diffVsFair: -0.7, trap: "Vantage again, cheap again, through the Bosphorus in fog season." }),
  T("o10", 52, 9, { counterparty: "NORTHSEA_MAJOR", side: "offer", grade: "FORTIES", bbl: 600000, incoterm: "FOB", port: "SULLOM_VOE", basis: "DATED", windowKind: "after_bl", windowDays: 5, laycanStart: 58, laycanDays: 2, openHours: 48, diffVsFair: -0.35 }),
  T("b10", 60, 10, { counterparty: "RHINE_REFINING", side: "bid", grade: "FORTIES", bbl: 600000, incoterm: "CIF", port: "ROTTERDAM", basis: "DATED", windowKind: "after_discharge", windowDays: 5, laycanStart: 66, laycanDays: 4, openHours: 72, diffVsFair: 0.1 }),
  T("o11", 58, 9, { counterparty: "GULF_NATIONAL", side: "offer", grade: "BASRAH_MEDIUM", bbl: 2000000, incoterm: "FOB", port: "BASRAH", basis: "DUBAI", windowKind: "after_bl", windowDays: 5, laycanStart: 64, laycanDays: 2, openHours: 60, diffVsFair: -0.55, requiresLc: true }),
  T("b11", 66, 10, { counterparty: "EASTERN_PACIFIC", side: "bid", grade: "BASRAH_MEDIUM", bbl: 2000000, incoterm: "DES", port: "JAMNAGAR", basis: "DUBAI", windowKind: "after_discharge", windowDays: 5, laycanStart: 78, laycanDays: 8, openHours: 72, diffVsFair: 0.1 }),
  T("o12", 70, 9, { counterparty: "STELLAR", side: "offer", grade: "FORTIES", bbl: 600000, incoterm: "FOB", port: "SULLOM_VOE", basis: "DATED", windowKind: "after_bl", windowDays: 5, laycanStart: 76, laycanDays: 2, openHours: 48, diffVsFair: 0.1 }),
];

function quiz(s: State): QuizQuestion[] {
  const declined = s.tenders.filter((t) => t.status === "declined").length;
  return [
    { id: "q1", text: `You declined ${declined} tenders this quarter. A cheap offer is worth taking when:`, choices: ["It is the cheapest on the screen", "Its edge over fair survives the window, the freight, the name's record and the line it uses, and a buyer exists for the oil", "The mentor says so", "Always"], correct: 1, explanation: "The differential is the start of the arithmetic, not the end of it." },
    { id: "q2", text: "The best bid on the screen came from the refiner that pays late. The right answer was:", choices: ["Take it: a bid is a bid", "Decline or sell to the fair bid that pays on time: a dime of edge does not cover twelve days of the line and a downgrade", "Counter higher", "Insure it"], correct: 1, explanation: "A late payer is a loan you did not price." },
    { id: "q3", text: "A P&L budget inside a risk budget means:", choices: ["Make the number whatever it takes", "The number is only a pass when the book stayed inside VaR, gross and net at every close on the way", "Risk does not matter", "VaR is the budget"], correct: 1, explanation: "The quarter is scored on the number and on how it was made." },
  ];
}

export const level19: LevelSpec = {
  id: 19, tier: 5, title: "The quarter", subtitle: "Everything unlocked, a P&L budget, a risk budget, a full tender flow, counterparties that remember",
  days: DAYS, startDate: "2027-07-05", capital: 50e6, creditLine: 400e6, lives: 3,
  instruments: ["BRENT", "WTI", "DUBAI", "RBOB", "ULSD", "HH", "TTF", "JKM"], unlocks: TIER4_UNLOCKS, infoDelayHours: 36, backMonthDepth: 0.5, mentorSilent: true,
  regime: "normal", world: { oecdInvGap: 8, crudeBalance: 0, geo: 0.3 }, factors: { brentRef: refFor(78, 8, 0.3) },
  limits: { var95: 5e6, netLots: TIER4_LIMITS({ BRENT: 2500, WTI: 1500, DUBAI: 2500, RBOB: 500, ULSD: 500, HH: 300, TTF: 300, JKM: 300 }), grossLots: 7000, stopLoss: 10e6, drawdown: 12e6, concentration: 50 },
  events: [
    ...flow,
    { id: "inv1", kind: "inventory_release", day: 2, hour: 14 }, { id: "inv2", kind: "inventory_release", day: 9, hour: 14 }, { id: "inv3", kind: "inventory_release", day: 16, hour: 14 }, { id: "inv4", kind: "inventory_release", day: 23, hour: 14 }, { id: "inv5", kind: "inventory_release", day: 30, hour: 14 }, { id: "inv6", kind: "inventory_release", day: 37, hour: 14 }, { id: "inv7", kind: "inventory_release", day: 44, hour: 14 }, { id: "inv8", kind: "inventory_release", day: 51, hour: 14 }, { id: "inv9", kind: "inventory_release", day: 58, hour: 14 }, { id: "inv10", kind: "inventory_release", day: 65, hour: 14 }, { id: "inv11", kind: "inventory_release", day: 72, hour: 14 }, { id: "inv12", kind: "inventory_release", day: 79, hour: 14 },
    { id: "down", kind: "rating_change", day: 4, hour: 9, params: { counterparty: "ADRIATIC_SMALL", delta: -12, body: "Adriatic Smallworks downgraded: working capital strained." } },
    { id: "r1", kind: "rumour", day: 14, hour: 10, params: { headline: "Rumour: OPEC+ to bring forward its meeting", moveNow: 0.01, resolveHours: 48, pTrue: 0.5, eventKind: "balance_shift", eventParams: "{\"kbd\":-300,\"headline\":\"OPEC+ trims output by 300 kb/d at an early meeting\"}" } },
    { id: "opec", kind: "opec_meeting", day: 27, hour: 13, params: { decision: "random", kbd: 400 } },
    { id: "rate", kind: "rate_move", day: 31, hour: 13, params: { bp: 25 } },
    { id: "redsea", kind: "chokepoint", day: 41, hour: 9, params: { id: "BAB_EL_MANDEB", status: "restricted" } },
    { id: "redsea_open", kind: "chokepoint", day: 53, hour: 9, params: { id: "BAB_EL_MANDEB", status: "open" } },
    { id: "claim", kind: "quality_claim", day: 46, hour: 11, params: { usdPerBbl: 0.3 } },
    { id: "r2", kind: "rumour", day: 56, hour: 10, params: { headline: "Rumour: a North Sea field outage", moveNow: 0.012, resolveHours: 36, pTrue: 0.5, eventKind: "field_outage", eventParams: "{\"kbd\":250,\"headline\":\"Forties pipeline system shut for repairs\"}" } },
    { id: "queue", kind: "port_congestion", day: 63, hour: 9, params: { port: "ROTTERDAM", hours: 60 } },
    { id: "r3", kind: "rumour", day: 74, hour: 10, params: { headline: "Rumour: China stimulus package", moveNow: 0.01, resolveHours: 48, pTrue: 0.5, eventKind: "balance_shift", eventParams: "{\"kbd\":-250,\"headline\":\"Beijing announces a stimulus; Asian runs rise\"}" } },
    { id: "pos", kind: "positioning_report", day: 80, hour: 15 },
  ],
  briefing: `Ninety days, everything on the desk unlocked, a P&L budget of ${usd(BUDGET)} and a risk budget: VaR ${usd(5e6)}, gross 7,000 lots. Offers and bids arrive every few days from every name you have met; some are cheap for a reason, one hides a time spread in its window, one comes from the refiner that pays late. Counterparties remember a dispute. No cards unless you ask; the mentor answers questions and nothing else.

Pass: the budget met (or the solution bot's own result on your seed, when even the bot fell short of it), inside the limits at every close, no life lost, no forced reduction, no margin call.`,
  objectives: [
    { id: "budget", text: `P&L at least ${usd(BUDGET)} (or the solution bot's own result on this seed, when the bot fell short)`, check: budgetMet, detail: (s) => `P&L ${usd(s.pnl.total)} against ${usd(target(s))}` },
    { id: "var", text: "VaR inside the limit at every close", check: varInsideEveryClose, detail: (s) => `${s.risk.closesInsideLimit} of ${s.risk.closesTotal} closes` },
    { id: "forced", text: "No forced reduction", check: noForced },
    { id: "cash", text: "No margin call", check: cashOk },
    { id: "lives", text: "No life lost", check: noLife },
  ],
  cards: [],
  askMentor: askMentorTier4,
  pass: (s) => budgetMet(s) === "done" && varInsideEveryClose(s) === "done" && noForced(s) === "done" && cashOk(s) === "done" && noLife(s) === "done",
  passRuleText: `P&L at least ${usd(BUDGET)} (or the solution bot's own result on this seed when the bot fell short), VaR inside at every close, no forced reduction, no margin call, no life lost, and a correct debrief.`,
  quiz,
  par: 2144982.96, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
  seeds: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12],
  solve: (s) => genericTrade(s, { minEdge: 0.2, maxCargoes: 3 }),
};
