import { counterpartyExposure, COUNTERPARTIES, type LevelSpec, type QuizQuestion, type State } from "@desk/engine";
import { P, accept, cargoFrom, fixCheapest, hedgeAdjustment, hedgeChunk, isOpen, leg, openBids, openOffers, quizAnswers, refFor, usd, TIER3_LIMITS, TIER3_UNLOCKS } from "../bot";
import { askMentorTier1, tier1Mentor } from "../mentor";

const disputeSettled = (s: State) => s.cargoes.some((c) => c.claims.some((k) => k.status !== "open"));
const concentrationClean = (s: State): "pending" | "done" | "failed" => (s.risk.messages.some((m) => m.text.includes("concentration")) ? "failed" : s.risk.closesTotal > 3 ? "done" : "pending");

function quiz(s: State): QuizQuestion[] {
  const v = s.counterparties.VANTAGE;
  return [
    { id: "q1", text: `Vantage offered the cheapest cargo on the screen and ${v?.defaulted ? "defaulted" : "was rated " + (v?.rating ?? "BB")}. The cheapness was paying you for:`, choices: ["Their generosity", "The chance they would not perform: a credit premium", "Better quality oil", "Shorter laycan"], correct: 1, explanation: "A name that needs the trade most is the name most likely not to be there at the laycan. Price the name." },
    { id: "q2", text: "Concentration is measured as:", choices: ["Lots per instrument", "What one counterparty owes you plus what you have paid it for oil not yet received, against your capital", "The number of cargoes", "VaR per counterparty"], correct: 1, explanation: "Receivables, prepayments and undelivered cargoes, by name, as a multiple of capital." },
    { id: "q3", text: `Adriatic Smallworks ${s.counterparties.ADRIATIC_SMALL?.late ? "paid late" : "bids high and pays late"}. The cost of a late payer is:`, choices: ["Nothing if they pay eventually", "Interest on the line for the days you wait, and the risk they never pay", "A fee from the bank", "Demurrage"], correct: 1, explanation: "Money has a price every day; a late receivable is a loan you did not agree to make." },
    { id: "q4", text: `Credit leg ${usd(leg(s, "credit"))}, finance leg ${usd(leg(s, "finance"))}. Non-performance insurance:`, choices: ["Is free with the LC", "Costs a premium and pays most of the loss on a covered default", "Guarantees delivery", "Replaces due diligence"], correct: 1, explanation: "A premium now against a recovery later; it does not make a bad name good." },
  ];
}

export const level11: LevelSpec = {
  id: 11, tier: 3, title: "Counterparties", subtitle: "The cheapest offer, the one that disappears, the one that pays late, and the inspector",
  days: 45, startDate: "2027-03-01", capital: 50e6, creditLine: 400e6, lives: 3,
  instruments: ["BRENT", "DUBAI"], unlocks: TIER3_UNLOCKS, infoDelayHours: 12,
  regime: "normal", world: { oecdInvGap: 0, crudeBalance: 0 }, factors: { brentRef: refFor(77, 0) },
  limits: { var95: 6e6, netLots: TIER3_LIMITS(3000), grossLots: 6000, stopLoss: 8e6, drawdown: 10e6, concentration: 2.0 },
  events: [
    { id: "stellar", kind: "tender", day: 0, hour: 9, params: { counterparty: "STELLAR", side: "offer", grade: "ES_SIDER", bbl: 1000000, incoterm: "FOB", port: "ES_SIDER", windowKind: "after_bl", windowDays: 5, laycanStart: 4, laycanDays: 2, openHours: 60 } },
    { id: "vantage", kind: "tender", day: 0, hour: 9, params: { counterparty: "VANTAGE", side: "offer", grade: "BONNY_LIGHT", bbl: 1000000, incoterm: "FOB", port: "BONNY", windowKind: "after_bl", windowDays: 5, laycanStart: 9, laycanDays: 2, openHours: 60, diffVsFair: -0.5, trap: "The cheapest cargo on the screen was cheap because the seller was already in trouble." } },
    { id: "meridian", kind: "tender", day: 0, hour: 10, params: { counterparty: "MERIDIAN_TRADERS", side: "offer", grade: "FORTIES", bbl: 600000, incoterm: "FOB", port: "SULLOM_VOE", windowKind: "after_bl", windowDays: 5, laycanStart: 10, laycanDays: 2, openHours: 60 } },
    { id: "rhine", kind: "tender", day: 1, hour: 10, params: { counterparty: "RHINE_REFINING", side: "bid", grade: "ES_SIDER", bbl: 1000000, incoterm: "CIF", port: "ROTTERDAM", windowKind: "after_discharge", windowDays: 5, laycanStart: 12, laycanDays: 8, openHours: 96 } },
    { id: "adriatic", kind: "tender", day: 1, hour: 11, params: { counterparty: "ADRIATIC_SMALL", side: "bid", grade: "ES_SIDER", bbl: 1000000, incoterm: "CIF", port: "ROTTERDAM", windowKind: "after_discharge", windowDays: 5, laycanStart: 12, laycanDays: 8, openHours: 96, diffVsFair: 0.3, trap: "The highest bid came from the slowest payer." } },
    { id: "downgrade", kind: "rating_change", day: 2, hour: 11, params: { counterparty: "ADRIATIC_SMALL", delta: -12, body: "The agency cites stretched payables." } },
    { id: "vanish", kind: "counterparty_vanish", day: 3, hour: 9, params: { counterparty: "MERIDIAN_TRADERS" } },
    { id: "default", kind: "counterparty_default", day: 7, hour: 9, params: { counterparty: "VANTAGE", headline: "Vantage Commodities stops performing; banks pull its lines", body: "Cargoes it sold will not load. Cargoes it bought will not be paid." } },
    { id: "claim", kind: "quality_claim", day: 15, hour: 9, params: { usdPerBbl: 0.3, text: "Sulphur tested 0.47% against the 0.40% in the contract." } },
  ],
  briefing: `Forty-five days and three sellers: Stellar at fair, Vantage well under fair, Meridian in between. Two buyers for the Es Sider: Rhine at fair and Adriatic Smallworks above it. Ratings are on the Desk. Insurance against non-performance is on every cargo card. The concentration limit is twice capital: no single name may owe you, or hold your money for undelivered oil, for more than $100m.

Something will go wrong with at least one of these names. Buy what you can price, insure what you cannot, sell to the buyer who pays, and settle what the inspector finds.

Pass: exposure to any one name inside the concentration limit at every close, a dispute settled, a cargo delivered.`,
  objectives: [
    { id: "conc", text: "Inside the concentration limit (2x capital per name) at every close", check: concentrationClean, detail: (s) => { const cx = counterpartyExposure(s); const w = Object.entries(cx.byId).sort((a, b) => b[1] - a[1])[0]; return w ? `${COUNTERPARTIES[w[0]]?.name} ${(w[1] / s.capital).toFixed(1)}x capital` : "no exposure"; } },
    { id: "dispute", text: "A dispute settled", check: (s) => (disputeSettled(s) ? "done" : "pending") },
    { id: "delivered", text: "Deliver a cargo", check: (s) => (s.cargoes.some((c) => c.status === "delivered") ? "done" : s.level.status === "running" ? "pending" : "failed") },
  ],
  cards: [
    { id: "cheapest_for_a_reason", trigger: () => true },
    { id: "concentration", trigger: (s) => s.cargoes.length > 0 },
    { id: "due_diligence", trigger: (s) => s.cargoes.some((c) => c.insured) || s.cargoes.some((c) => c.claims.length > 0) },
  ],
  mentor: (s, ev) => {
    const lines = tier1Mentor(s, ev);
    if (s.tick === 0 && ev.length === 0) lines.push("Three sellers. One of them is cheap because he has to be. Look at the rating before the differential, and never let one name be half your book.");
    if (ev.some((e) => e.kind === "credit" && e.text.includes("defaulted"))) lines.push("And there it is. If you insured it, you get most of the edge back. If you sold it on, you owe the receiver.");
    if (ev.some((e) => e.kind === "credit" && e.text.includes("late"))) lines.push("Late. Your line pays the interest while they 'process' it. That is what the rating was for.");
    if (ev.some((e) => e.text.includes("closes its doors"))) lines.push("Gone. No claim either way, this time. Next time the cargo might have been loaded.");
    return lines;
  },
  askMentor: askMentorTier1,
  pass: (s) => concentrationClean(s) === "done" && disputeSettled(s) && s.cargoes.some((c) => c.status === "delivered"),
  passRuleText: "Inside the concentration limit at every close, a dispute settled, a cargo delivered, and a correct debrief.",
  quiz,
  par: 460113.83, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
  seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  solve: (s) => {
    if (s.level.status === "ended") return quizAnswers(s);
    if (s.level.status !== "running") return [];
    const offers = openOffers(s);
    const stellar = offers.find((t) => t.counterparty === "STELLAR"), vantage = offers.find((t) => t.counterparty === "VANTAGE"), meridian = offers.find((t) => t.counterparty === "MERIDIAN_TRADERS");
    if (stellar && !cargoFrom(s, "STELLAR")) return [accept(stellar.id)];
    const es = cargoFrom(s, "STELLAR");
    // the reliable buyer, not the high bidder who pays late; sold before the cheap cargo so no name is half the book
    const rhine = openBids(s).find((t) => t.counterparty === "RHINE_REFINING");
    if (es && rhine && !es.sale) return [accept(rhine.id, es.id)];
    if (es && !es.vesselId && es.status === "contracted") { const f = fixCheapest(s, es); if (f) return [f]; }
    if (vantage && es && es.sale && !cargoFrom(s, "VANTAGE")) return [accept(vantage.id)];
    const bonny = cargoFrom(s, "VANTAGE");
    if (bonny && !bonny.insured && bonny.status !== "cancelled") return [{ type: "insure", player: P, cargoId: bonny.id }];
    if (meridian && es && es.sale) return [{ type: "decline_tender", player: P, tenderId: meridian.id, reason: "two cargoes is the book for this month; Meridian's quote is mid-pack and the laycan is late" }];
    const adriatic = openBids(s).find((t) => t.counterparty === "ADRIATIC_SMALL");
    if (adriatic && es && es.sale) return [{ type: "decline_tender", player: P, tenderId: adriatic.id, reason: "B-rated and pays twelve days late; the premium does not cover the line" }];
    for (const c of s.cargoes) { const claim = c.claims.find((k) => k.status === "open"); if (claim) return [{ type: "settle_claim", player: P, cargoId: c.id, claimId: claim.id }]; }
    if (isOpen(s)) { const o = hedgeChunk("BRENT", s.listed.BRENT[1], hedgeAdjustment(s)); if (o) return [o]; }
    return [];
  },
};
