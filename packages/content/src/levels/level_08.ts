import type { LevelSpec, QuizQuestion, State } from "@desk/engine";
import { P, accept, cargo0, fixCheapest, hedgeAdjustment, hedgeChunk, hedgeRecord, isOpen, leg, openBids, openOffers, quizAnswers, refFor, usd, TIER2_LIMITS, TIER2_UNLOCKS } from "../bot";
import { askMentorTier1, tier1Mentor } from "../mentor";

const delivered = (s: State) => s.cargoes.some((c) => c.status === "delivered");
/** A calendar spread package bought front against second, of at least half the cargo, while the cargo was exposed to the mismatch. */
const spreadHedged = (s: State) => {
  const c = s.cargoes[0];
  if (!c) return false;
  let buyFront = 0, sellSecond = 0;
  for (const f of s.fills) {
    if (f.tag !== "time_spread" || !f.packageId) continue;
    if (f.side === "buy") buyFront += f.qty; else sellSecond += f.qty;
  }
  return buyFront >= c.bbl / 2000 && sellSecond >= c.bbl / 2000;
};

function quiz(s: State): QuizQuestion[] {
  const ts = leg(s, "time_spread");
  return [
    { id: "q1", text: `Your time-spread leg was ${usd(ts)}. A purchase priced on the month average and a sale priced a month later is:`, choices: ["Flat: both are Dated", "Long a time spread: short the earlier period, long the later one", "Short a time spread", "A freight exposure"], correct: 1, explanation: "You pay the average of one period and receive the average of a later one: that difference is a time spread, and you are long it." },
    { id: "q2", text: "In backwardation that position:", choices: ["Earns: the later period is dearer", "Bleeds: the later period is cheaper, and the curve already says so at inception", "Is unaffected", "Depends on freight"], correct: 1, explanation: "Backwardation prices the later period below the earlier one; the mark shows the loss before the market moves at all." },
    { id: "q3", text: "The hedge for it is:", choices: ["Sell outright futures", "A calendar spread the other way: long the earlier month, short the later one", "A crack spread", "An EFP"], correct: 1, explanation: "A time spread hedges a time spread; outright futures hedge the flat price and leave the mismatch." },
    { id: "q4", text: "A deemed B/L:", choices: ["Means the ship was late", "Fixes the pricing anchor on a stated date whatever the ship does", "Is a type of demurrage", "Only applies to Dubai"], correct: 1, explanation: "It takes the timing out of the seller's hands at a price in the differential." },
  ];
}

export const level08: LevelSpec = {
  id: 8, tier: 2, title: "The hidden time spread", subtitle: "A month-average purchase, a five-day sale a month later, a backwardated curve",
  days: 45, startDate: "2027-03-01", capital: 20e6, creditLine: 150e6, lives: 3,
  instruments: ["BRENT"], unlocks: TIER2_UNLOCKS,
  regime: "normal", world: { oecdInvGap: -22, crudeBalance: -200, targets: { crudeBalance: -200 } }, factors: { brentRef: refFor(78, -22) },
  limits: { var95: 5e6, netLots: TIER2_LIMITS(2500), grossLots: 5000, stopLoss: 6e6, drawdown: 7e6, concentration: 50 },
  events: [
    { id: "offer", kind: "tender", day: 0, hour: 9, params: { counterparty: "GULF_NATIONAL", side: "offer", grade: "ARAB_LIGHT", bbl: 1000000, incoterm: "FOB", port: "RAS_TANURA", basis: "DATED", windowKind: "month_avg_bl", laycanStart: 5, laycanDays: 2, openHours: 72, note: "Gulf National offers a Suezmax of Arab Light FOB Ras Tanura, laycan days 5-7, Dated plus the differential shown, priced on the average of the B/L month." } },
    { id: "bid", kind: "tender", day: 2, hour: 10, params: { counterparty: "RHINE_REFINING", side: "bid", grade: "ARAB_LIGHT", bbl: 1000000, incoterm: "CIF", port: "ROTTERDAM", basis: "DATED", windowKind: "after_discharge", windowDays: 5, laycanStart: 31, laycanDays: 5, openHours: 96, note: "Rhine Refining bids for an Arab Light cargo CIF Rotterdam, discharge days 31-36, Dated plus the differential shown, pricing 5 days after discharge." } },
    { id: "draw", kind: "field_outage", day: 14, hour: 9, params: { kbd: 400, headline: "North Sea outage tightens the prompt; backwardation steepens", body: "Prompt barrels are scarcer. The front spread widens: the curve now charges more for carrying a cargo into a later window." } },
  ],
  briefing: `Forty-five days and a Suezmax of Arab Light from the Gulf, priced on the average of the B/L month; Rhine Refining will bid for it CIF Rotterdam pricing five days after discharge, about a month later. The curve is backwardated.

Look at the mark the moment you accept: the time-spread leg is already negative. You are short the month and long a window a month later; the curve charges you for the gap before anything moves. Hedge the flat price with futures as the month prints, and hedge the mismatch with a calendar spread the other way, as a package.

Pass: name the exposure in the debrief and hedge it with a time-spread package of at least half the cargo. Most players bleed the first time; replay it.`,
  objectives: [
    { id: "delivered", text: "Deliver the cargo", check: (s) => (delivered(s) ? "done" : s.level.status === "running" ? "pending" : "failed") },
    { id: "spread", text: "Hedge the window mismatch with a calendar-spread package (buy front, sell second) of at least half the cargo", check: (s) => (spreadHedged(s) ? "done" : "pending") },
    { id: "flat", text: "Flat-price hedge in place: ratio within 20% of one at closes with exposure", check: (s) => { const r = hedgeRecord(s, "BRENT", 0.2); return r.total === 0 ? "pending" : r.inside >= r.total * 0.8 ? "done" : "failed"; }, detail: (s) => { const r = hedgeRecord(s, "BRENT", 0.2); return `${r.inside} of ${r.total} closes inside`; } },
  ],
  cards: [
    { id: "window_mismatch", trigger: () => true },
    { id: "backwardation_taxes", trigger: (s) => s.cargoes.length > 0 },
    { id: "deemed_bl", trigger: (s) => s.cargoes.some((c) => c.blTick !== null) },
  ],
  mentor: (s, ev) => {
    const lines = tier1Mentor(s, ev);
    if (s.tick === 0 && ev.length === 0) lines.push("Read the windows before the differential. A month average against five days a month later is a spread, and in this curve it is a spread against you.");
    if (ev.some((e) => e.kind === "cargo" && e.text.startsWith("Bought"))) lines.push("Look at the time-spread bar on the Book. That is the curve's bill for the gap between your windows, due whether or not Brent moves.");
    if (ev.some((e) => e.text.includes("backwardation steepens"))) lines.push("Steeper. If the mismatch is hedged, that is someone else's problem now.");
    return lines;
  },
  askMentor: askMentorTier1,
  pass: (s) => delivered(s) && spreadHedged(s),
  passRuleText: "Cargo delivered, the mismatch hedged with a calendar-spread package of at least half the cargo, and a correct debrief.",
  quiz,
  par: -1088468.99, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
  seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  solve: (s) => {
    if (s.level.status === "ended") return quizAnswers(s);
    if (s.level.status !== "running") return [];
    const c = cargo0(s);
    const offer = openOffers(s)[0];
    if (!c && offer) return [accept(offer.id)];
    if (c && !c.vesselId) { const f = fixCheapest(s, c); if (f) return [f]; }
    const bid = openBids(s)[0];
    if (c && bid && !c.sale) return [accept(bid.id, c.id)];
    if (!c || !isOpen(s)) return [];
    // the mismatch: long the later window, short the month: buy the front against the second, in chunks
    if (c.sale && !spreadHedged(s)) {
      const lots = Math.round(c.bbl / 1000);
      const doneLots = s.fills.filter((f) => f.tag === "time_spread" && f.side === "buy").reduce((a, f) => a + f.qty, 0);
      const chunk = Math.min(250, lots - doneLots);
      if (chunk > 0) return [{ type: "spread", player: P, name: "time", legs: [{ inst: "BRENT", month: s.listed.BRENT[0], side: "buy", qty: chunk }, { inst: "BRENT", month: s.listed.BRENT[1], side: "sell", qty: chunk }] }];
    }
    // the flat price: the net physical barrels against the second month, so the hedge outlives the front's expiry
    // the spread package already carries lots in both months; only the net counts, so adjust in the second month
    const o = hedgeChunk("BRENT", s.listed.BRENT[1], hedgeAdjustment(s));
    if (o) return [o];
    return [];
  },
};
