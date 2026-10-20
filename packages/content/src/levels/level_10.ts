import { lineAvailable, lcCommitted, type LevelSpec, type QuizQuestion, type State } from "@desk/engine";
import { P, accept, cargoFrom, cashNeverNegative, fixCheapest, hedgeAdjustment, hedgeChunk, isOpen, leg, openBids, openOffers, quizAnswers, refFor, usd, TIER3_LIMITS, TIER3_UNLOCKS } from "../bot";
import { askMentorTier1, tier1Mentor } from "../mentor";

const FINANCE_BAND = 2500000; // USD: LC fees and interest on two financed cargoes for a month, stylised
const declinedWithReason = (s: State) => s.tenders.some((t) => t.status === "declined" && !!t.declineReason && t.declineReason.length > 10);

function quiz(s: State): QuizQuestion[] {
  const fin = leg(s, "finance");
  return [
    { id: "q1", text: `Your finance leg (LC fees, insurance, interest) was ${usd(fin)}. A letter of credit:`, choices: ["Is free if the cargo prices well", "Costs a fee on its face and holds that face off the line until the invoice is paid", "Replaces the need to pay the invoice", "Is only needed for Dubai cargoes"], correct: 1, explanation: "The bank's promise costs a fee every quarter and the face is credit you cannot use for anything else while it is open." },
    { id: "q2", text: "A prepayment discount is:", choices: ["Free money", "Interest you charge the producer, against the risk that they do not load", "A freight rebate", "A margin offset"], correct: 1, explanation: "You lend them the cargo's value until it prices; the discount is the rate, and the loan is unsecured." },
    { id: "q3", text: "Three cargoes were on offer and the line could carry two. The right move was:", choices: ["Take all three and hope the first pays before the third is due", "Take the two that fit and decline the third with a reason the counterparty can hear", "Take the cheapest and ignore the rest", "Take none"], correct: 1, explanation: "Working capital is a limit like VaR; declining with a reason keeps the name for next time." },
    { id: "q4", text: "Cost of carry on a cargo includes:", choices: ["Only freight", "Freight, storage and the interest on the money between paying and being paid", "Only the differential", "Only insurance"], correct: 1, explanation: "Money has a price every day it is out; the finance leg shows it." },
  ];
}

export const level10: LevelSpec = {
  id: 10, tier: 3, title: "Working capital", subtitle: "Three cargoes at once; the line and the letters of credit decide which two",
  days: 42, startDate: "2027-03-01", capital: 50e6, creditLine: 400e6, lives: 3,
  instruments: ["BRENT", "DUBAI"], unlocks: TIER3_UNLOCKS, infoDelayHours: 12,
  regime: "normal", world: { oecdInvGap: -5, crudeBalance: 0 }, factors: { brentRef: refFor(78, -5) },
  limits: { var95: 8e6, netLots: TIER3_LIMITS(4000), grossLots: 8000, stopLoss: 10e6, drawdown: 12e6, concentration: 50 },
  events: [
    { id: "a", kind: "tender", day: 0, hour: 9, params: { counterparty: "GULF_NATIONAL", side: "offer", grade: "ARAB_LIGHT", bbl: 2000000, incoterm: "FOB", port: "RAS_TANURA", basis: "DATED", windowKind: "after_bl", windowDays: 5, laycanStart: 4, laycanDays: 2, openHours: 60, requiresLc: true, diffVsFair: -0.1 } },
    { id: "b", kind: "tender", day: 0, hour: 9, params: { counterparty: "DELTA_INDEPENDENT", side: "offer", grade: "BONNY_LIGHT", bbl: 1000000, incoterm: "FOB", port: "BONNY", windowKind: "after_bl", windowDays: 5, laycanStart: 5, laycanDays: 2, openHours: 60, prepayDiscount: 0.35 } },
    { id: "c", kind: "tender", day: 0, hour: 9, params: { counterparty: "GULF_NATIONAL", side: "offer", grade: "BASRAH_MEDIUM", bbl: 2000000, incoterm: "FOB", port: "BASRAH", basis: "DATED", windowKind: "after_bl", windowDays: 5, laycanStart: 6, laycanDays: 2, openHours: 60, requiresLc: true, diffVsFair: -0.15 } },
    { id: "ba", kind: "tender", day: 1, hour: 10, params: { counterparty: "RHINE_REFINING", side: "bid", grade: "ARAB_LIGHT", bbl: 2000000, incoterm: "CIF", port: "ROTTERDAM", basis: "DATED", windowKind: "after_discharge", windowDays: 5, laycanStart: 30, laycanDays: 8, openHours: 96 } },
    { id: "bb", kind: "tender", day: 1, hour: 10, params: { counterparty: "RHINE_REFINING", side: "bid", grade: "BONNY_LIGHT", bbl: 1000000, incoterm: "CIF", port: "ROTTERDAM", basis: "DATED", windowKind: "after_discharge", windowDays: 5, laycanStart: 22, laycanDays: 8, openHours: 96 } },
    { id: "bc", kind: "tender", day: 1, hour: 10, params: { counterparty: "EASTERN_PACIFIC", side: "bid", grade: "BASRAH_MEDIUM", bbl: 2000000, incoterm: "DES", port: "JAMNAGAR", basis: "DUBAI", windowKind: "after_discharge", windowDays: 5, laycanStart: 20, laycanDays: 8, openHours: 96 } },
    { id: "rate", kind: "rate_move", day: 12, hour: 14, params: { bp: 50 } },
  ],
  briefing: `Forty-two days, $50m of capital and a $400m line. Three cargoes are on offer this morning: a VLCC of Arab Light and a VLCC of Basrah Medium from Gulf National, both needing a letter of credit before loading, and a Suezmax of Bonny Light from Delta Independent, who will take 35 cents off the differential if you pay before it prices.

A letter of credit holds its face off the line until the invoice is paid; a prepayment draws the line today. Do the arithmetic on the Finance screen before you accept: the line carries two of these, not three. Decline the third with a reason. Hedge what you take, sell it, and watch the finance leg.

Pass: cash never negative at a close, the finance leg inside ${usd(FINANCE_BAND)}, one cargo declined with a stated reason.`,
  objectives: [
    { id: "cash", text: "Cash never negative at a close, no margin call", check: cashNeverNegative },
    { id: "finance", text: `Finance leg (LC fees, interest) inside ${usd(FINANCE_BAND)}`, check: (s) => (Math.abs(leg(s, "finance")) > FINANCE_BAND ? "failed" : s.level.status === "running" ? "pending" : "done"), detail: (s) => `finance leg ${usd(leg(s, "finance"))}` },
    { id: "decline", text: "One cargo declined with a stated reason", check: (s) => (declinedWithReason(s) ? "done" : "pending") },
    { id: "delivered", text: "Deliver what you bought", check: (s) => (s.cargoes.length > 0 && s.cargoes.every((c) => c.status === "delivered" || c.status === "cancelled") ? "done" : s.level.status === "running" ? "pending" : "failed") },
  ],
  cards: [
    { id: "cost_of_carry_money", trigger: () => true },
    { id: "lc_promise_fee", trigger: (s) => s.tenders.some((t) => t.requiresLc) },
    { id: "prepayment_is_a_loan", trigger: (s) => s.tenders.some((t) => t.prepayDiscount > 0) },
  ],
  mentor: (s, ev) => {
    const lines = tier1Mentor(s, ev);
    if (s.tick === 0 && ev.length === 0) lines.push("Three cargoes, one line. Before you say yes to anything, add up the letters of credit and the prepayment on Finance. The third one is the one you learn to decline.");
    if (ev.some((e) => e.kind === "finance" && e.text.startsWith("Opened"))) lines.push(`That face is off the line until the invoice clears. ${usd(lineAvailable(s))} left, with ${usd(lcCommitted(s))} committed.`);
    if (ev.some((e) => e.text.includes("Base rate up"))) lines.push("Rates up fifty. Every day of every dollar you have out just got dearer. The finance leg will show it.");
    return lines;
  },
  askMentor: askMentorTier1,
  pass: (s) => cashNeverNegative(s) === "done" && Math.abs(leg(s, "finance")) <= FINANCE_BAND && declinedWithReason(s),
  passRuleText: `Cash never negative at a close, finance leg inside ${usd(FINANCE_BAND)}, one cargo declined with a reason, and a correct debrief.`,
  quiz,
  par: -1668812.49, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
  seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  solve: (s) => {
    if (s.level.status === "ended") return quizAnswers(s);
    if (s.level.status !== "running") return [];
    const offers = openOffers(s);
    const a = offers.find((t) => t.grade === "ARAB_LIGHT"), b = offers.find((t) => t.grade === "BONNY_LIGHT"), c = offers.find((t) => t.grade === "BASRAH_MEDIUM");
    // the arithmetic: two letters of credit at $160m and $150m plus a $80m prepayment is more than the line; take the Arab Light (LC) and the Bonny (prepaid), decline the Basrah
    if (a && !cargoFrom(s, "GULF_NATIONAL")) return [accept(a.id)];
    if (b && !cargoFrom(s, "DELTA_INDEPENDENT")) return [{ type: "accept_tender", player: P, tenderId: b.id, prepay: true }];
    if (c && cargoFrom(s, "GULF_NATIONAL") && cargoFrom(s, "DELTA_INDEPENDENT")) return [{ type: "decline_tender", player: P, tenderId: c.id, reason: `line: the Arab Light letter of credit and the Bonny prepayment leave ${usd(lineAvailable(s))}; a second $150m letter of credit does not fit` }];
    for (const cg of s.cargoes) {
      if (cg.status === "cancelled") continue;
      if (cg.requiresLc && !cg.lcId && (cg.status === "contracted" || cg.status === "fixed")) return [{ type: "open_lc", player: P, cargoId: cg.id }];
      if (!cg.vesselId && cg.status === "contracted") { const f = fixCheapest(s, cg); if (f) return [f]; }
      const bid = openBids(s).find((t) => t.grade === cg.grade);
      if (bid && !cg.sale) return [accept(bid.id, cg.id)];
    }
    if (isOpen(s)) { const o = hedgeChunk("BRENT", s.listed.BRENT[1], hedgeAdjustment(s)); if (o) return [o]; }
    return [];
  },
};
