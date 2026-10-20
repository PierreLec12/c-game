import type { LevelSpec, QuizQuestion, State } from "@desk/engine";
import { P, accept, cargo0, fixCheapest, hedgeAdjustment, hedgeChunk, insideLimitsEveryClose, isOpen, openBids, openOffers, quizAnswers, refFor, usd, TIER3_LIMITS, TIER3_UNLOCKS } from "../bot";
import { askMentorTier1, tier1Mentor } from "../mentor";

const TARGET = 200000; // the stated P&L target
const hitTarget = (s: State): "pending" | "done" | "failed" => (s.level.status === "running" ? (s.pnl.total >= TARGET ? "done" : "pending") : s.pnl.total >= TARGET ? "done" : "failed");

function quiz(s: State): QuizQuestion[] {
  const w = s.risk.stress.length ? s.risk.stress.reduce((a, r) => (r.pnlChange < a.pnlChange ? r : a), s.risk.stress[0]) : null;
  return [
    { id: "q1", text: `Your VaR limit was ${usd(s.risk.limits.var95)}. A one-day 95% VaR of that size means:`, choices: ["You cannot lose more than that in a day", "One day in twenty loses more than that; the stress table says how much more", "The average daily loss is that", "Nothing about the tails"], correct: 1, explanation: "VaR is a quantile. The stress table re-prices the book under a stated shock and is the number the risk manager quotes." },
    { id: "q2", text: w ? `The worst stress row was a ${Math.round(w.priceShock * 100)}% move costing ${usd(w.pnlChange)}. Gross exposure matters because:` : "Gross exposure matters because:", choices: ["It is always larger than net", "A hedged book is net flat and gross twice the cargo; basis and timing act on the gross", "The exchange charges it", "It equals VaR"], correct: 1, explanation: "What goes wrong when hedge and hedged stop moving together scales with the gross." },
    { id: "q3", text: "When the scare doubled vol, the right time to cut was:", choices: ["After the second warning", "Before the close, at your price, before the risk manager cut it at the touch", "Never: hedged books do not need cutting", "At expiry"], correct: 1, explanation: "A breach at the close is a warning, a second close is a forced cut, a third is a life. The cheapest exit is the one you choose." },
    { id: "q4", text: "A request to raise a limit is granted:", choices: ["Always", "On a clean track record, before you need it", "When you are in breach", "Never"], correct: 1, explanation: "The risk manager lends discipline to people who have shown it." },
  ];
}

export const level12: LevelSpec = {
  id: 12, tier: 3, title: "The risk manager", subtitle: "Tight VaR, the stress table, and a scare that doubles vol",
  days: 36, startDate: "2027-03-01", capital: 50e6, creditLine: 400e6, lives: 3,
  instruments: ["BRENT", "WTI", "DUBAI"], unlocks: TIER3_UNLOCKS, infoDelayHours: 12,
  regime: "normal", world: { oecdInvGap: 1, crudeBalance: 0, geo: 0.3 }, factors: { brentRef: refFor(79, 1, 0.3) },
  limits: { var95: 1.5e6, netLots: TIER3_LIMITS(1100, 600), grossLots: 2400, stopLoss: 3e6, drawdown: 4e6, concentration: 50 },
  events: [
    { id: "offer", kind: "tender", day: 0, hour: 9, params: { counterparty: "GULF_NATIONAL", side: "offer", grade: "ARAB_LIGHT", bbl: 1000000, incoterm: "FOB", port: "RAS_TANURA", basis: "DATED", windowKind: "after_bl", windowDays: 5, laycanStart: 3, laycanDays: 2, openHours: 60, diffVsFair: -0.7 } },
    { id: "bid", kind: "tender", day: 1, hour: 10, params: { counterparty: "RHINE_REFINING", side: "bid", grade: "ARAB_LIGHT", bbl: 1000000, incoterm: "CIF", port: "ROTTERDAM", basis: "DATED", windowKind: "after_discharge", windowDays: 5, laycanStart: 26, laycanDays: 6, openHours: 96, diffVsFair: 0.1 } },
    { id: "scare", kind: "geo_scare", day: 8, hour: 11, params: { geo: 0.35, headline: "Tanker seized off Hormuz; war-risk premiums double, vol with them", body: "Implied vol doubles into the close. Every VaR on the desk is wrong until the history catches up; the stress table is not." } },
  ],
  briefing: `Thirty-six days with the tightest limits yet: a $1.5m VaR, 1,100 net Brent lots, 2,400 gross, and a $250,000 P&L target. Gulf National is offering a Suezmax of Arab Light seventy cents under fair; Rhine will bid for it a dime over. The edge is the target. Hedge it and keep the book inside the lines at every close.

On day 8 something will double the vol. The VaR will catch up by the close; the stress table on the Book is already right. Reduce before you are told.

Pass: inside every limit at every close, P&L at least ${usd(TARGET)}, at most one life lost.`,
  objectives: [
    { id: "limits", text: "Inside every limit at every close (no warnings)", check: insideLimitsEveryClose, detail: (s) => `${s.risk.closesInsideLimit} of ${s.risk.closesTotal} closes inside the VaR limit; ${s.risk.messages.filter((m) => m.severity !== "info").length} risk messages` },
    { id: "target", text: `P&L at least ${usd(TARGET)}`, check: hitTarget, detail: (s) => `P&L ${usd(s.pnl.total)}` },
    { id: "lives", text: "At most one life lost", check: (s) => (s.risk.livesLost > 1 ? "failed" : s.level.status === "running" ? "pending" : "done") },
  ],
  cards: [
    { id: "var_is_a_quantile", trigger: () => true },
    { id: "gross_vs_net", trigger: (s) => s.lots.length > 0 },
    { id: "reduce_before_told", trigger: (s) => s.world.geo > 0.5 || s.risk.messages.length > 0 },
  ],
  mentor: (s, ev) => {
    const lines = tier1Mentor(s, ev);
    if (s.tick === 0 && ev.length === 0) lines.push("Lindqvist has the limits tight this month. The cargo's edge is your target; the hedge is how you keep it. Watch gross, not just net.");
    if (ev.some((e) => e.text.includes("war-risk premiums double"))) lines.push("Vol just doubled. Your VaR will know by the close. Look at the stress table now and decide what you can carry.");
    if (ev.some((e) => e.kind === "limit_warning")) lines.push("A warning. One more close like that and he cuts you at the touch. Cut it yourself, at your price.");
    return lines;
  },
  askMentor: askMentorTier1,
  pass: (s) => insideLimitsEveryClose(s) === "done" && s.pnl.total >= TARGET && s.risk.livesLost <= 1,
  passRuleText: `Inside every limit at every close, P&L at least ${usd(TARGET)}, at most one life lost, and a correct debrief.`,
  quiz,
  par: 417631.76, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
  seeds: [1, 2, 3, 4, 6, 7, 8, 9, 10, 12],
  solve: (s) => {
    if (s.level.status === "ended") return quizAnswers(s);
    if (s.level.status !== "running") return [];
    const c = cargo0(s);
    const offer = openOffers(s)[0];
    if (!c && offer) return [accept(offer.id)];
    if (c && !c.vesselId && c.status === "contracted") { const f = fixCheapest(s, c); if (f) return [f]; }
    const bid = openBids(s)[0];
    if (c && bid && !c.sale) return [accept(bid.id, c.id)];
    if (c && isOpen(s)) { const o = hedgeChunk("BRENT", s.listed.BRENT[1], hedgeAdjustment(s)); if (o) return [o]; }
    return [];
  },
};
