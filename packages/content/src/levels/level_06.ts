import type { LevelSpec, QuizQuestion, State } from "@desk/engine";
import { P, accept, anchorDaysForQueue, cargo0, fixCheapest, hedgeAdjustment, hedgeChunk, hedgeRatio, hedgeRecord, isOpen, leg, openBids, openOffers, quizAnswers, refFor, second, usd, voyageOf, TIER2_LIMITS, TIER2_UNLOCKS } from "../bot";
import { askMentorTier1, tier1Mentor } from "../mentor";

const delivered = (s: State) => s.cargoes.some((c) => c.status === "delivered");
const FLAT_BAND = 250000; // USD: a hedged cargo leaves daily residuals from the lag between prints and fills (stylised)

/** Hedge discipline: at every close with real physical exposure, the ratio must be within 10% of one. */
const ratioRecord = (s: State) => hedgeRecord(s, "BRENT", 0.1);

function quiz(s: State): QuizQuestion[] {
  const flat = leg(s, "flat"), basis = leg(s, "basis");
  return [
    { id: "q1", text: `Flat-price leg ${usd(flat)}, basis leg ${usd(basis)}. A hedge that works leaves:`, choices: ["A large flat-price leg and no basis", "A quiet flat-price leg and a live basis leg", "Nothing: every leg is zero", "Only freight"], correct: 1, explanation: "Futures take the flat price; what is left is basis: Dated versus futures, the differential, timing." },
    { id: "q2", text: "How many Brent lots hedge 600,000 barrels?", choices: ["60", "600", "6,000", "It depends on the price"], correct: 1, explanation: "A lot is 1,000 barrels. Lots from barrels, not from dollars." },
    { id: "q3", text: `The front contract expired on day ${Math.floor((s.contracts[`BRENT:${s.listed.BRENT[0]}`]?.expiryTick ?? 0) / 24)} or thereabouts. A hedge placed in a month that expires mid-voyage:`, choices: ["Is fine: the clearer extends it", "Is cash-settled at expiry and leaves the cargo naked unless rolled", "Becomes physical delivery", "Costs double margin"], correct: 1, explanation: "Hedge the window with a month that outlives it, or roll before the expiry." },
    { id: "q4", text: "When should the hedge go on, and come off?", choices: ["On at the tender, off at delivery", "On as the purchase window prints, off as the sale window prints", "On at the B/L, off at discharge", "Whenever the price looks high"], correct: 1, explanation: "Hedge the unpriced barrels: as each purchase day prints you become longer; as each sale day prints you become flatter." },
  ];
}

export const level06: LevelSpec = {
  id: 6, tier: 2, title: "The hedge", subtitle: "The same cargo with Brent futures against it: lots from barrels, matched to each window",
  days: 35, startDate: "2027-03-15", capital: 20e6, creditLine: 150e6, lives: 3,
  instruments: ["BRENT"], unlocks: TIER2_UNLOCKS.filter((u) => !["efp"].includes(u)),
  regime: "normal", world: { oecdInvGap: -6, crudeBalance: 0 }, factors: { brentRef: refFor(75, -6) },
  limits: { var95: 3e6, netLots: TIER2_LIMITS(700), grossLots: 1400, stopLoss: 4e6, drawdown: 5e6, concentration: 50 },
  events: [
    { id: "offer", kind: "tender", day: 0, hour: 9, params: { counterparty: "NORTHSEA_MAJOR", side: "offer", grade: "FORTIES", incoterm: "FOB", port: "SULLOM_VOE", windowKind: "after_bl", windowDays: 5, laycanStart: 5, laycanDays: 2, openHours: 72, note: "Northsea Major offers one Aframax of Forties FOB Sullom Voe, laycan days 5-7, Dated plus the differential shown, pricing 5 days after B/L." } },
    { id: "bid", kind: "tender", day: 1, hour: 10, params: { counterparty: "RHINE_REFINING", side: "bid", grade: "FORTIES", incoterm: "CIF", port: "ROTTERDAM", windowKind: "after_discharge", windowDays: 5, laycanStart: 10, laycanDays: 4, openHours: 120, note: "Rhine Refining bids for a Forties cargo CIF Rotterdam, discharge days 10-14, Dated plus the differential shown, pricing 5 days after discharge." } },
    { id: "move", kind: "headline_move", day: 12, hour: 10, params: { pct: -0.045, headline: "Brent drops 4.5% on an OPEC+ surprise", body: "The same headline as last level. This time you have paper against the barrels, or you do not." } },
  ],
  briefing: `The same cargo, with Brent futures unlocked. Forties FOB Sullom Voe at Dated plus a differential, pricing five days after B/L; sold CIF Rotterdam pricing five days after discharge. Six hundred thousand barrels is six hundred lots.

Sell futures as the purchase window prints and buy them back as the sale window prints, tagged "hedge" on the ticket. Keep the ratio within 10% of one at every close while you are exposed. Hedge in a month that outlives the sale window: the front contract expires on day 16, in the middle of your voyage, and a hedge there is cash-settled and gone.

Pass: hedge ratio within 10% of one at every close with exposure, flat-price leg inside the noise band, cargo delivered.`,
  objectives: [
    { id: "delivered", text: "Deliver the cargo", check: (s) => (delivered(s) ? "done" : s.level.status === "running" ? "pending" : "failed") },
    { id: "ratio", text: "Hedge ratio within 10% of one at every close with exposure", check: (s) => { const r = ratioRecord(s); return r.total === 0 ? "pending" : r.inside === r.total ? "done" : "failed"; }, detail: (s) => { const r = ratioRecord(s); return `${r.inside} of ${r.total} closes inside`; } },
    { id: "flat", text: `Flat-price leg inside the noise band (within ${usd(FLAT_BAND)})`, check: (s) => (Math.abs(leg(s, "flat")) <= FLAT_BAND ? (delivered(s) ? "done" : "pending") : "failed"), detail: (s) => `flat leg ${usd(leg(s, "flat"))}` },
  ],
  cards: [
    { id: "lots_from_barrels", trigger: () => true },
    { id: "hedge_the_window", trigger: (s) => s.cargoes.length > 0 },
    { id: "basis_is_the_gap", trigger: (s) => s.fills.some((f) => f.tag === "hedge") },
  ],
  mentor: (s, ev) => {
    const lines = tier1Mentor(s, ev);
    if (s.tick === 0 && ev.length === 0) lines.push("Same cargo. This time you have paper. Six hundred lots, sold as the purchase prints, bought back as the sale prints. Not the front month: it dies on day 16.");
    if (ev.some((e) => e.kind === "expiry")) lines.push("That contract just expired with your hedge in it. The cargo is naked. Put it back on in the next month.");
    if (ev.some((e) => e.text.includes("drops 4.5%"))) lines.push("The same headline. Look at the flat leg. If it is quiet, the paper did its job.");
    return lines;
  },
  askMentor: askMentorTier1,
  pass: (s) => { const r = ratioRecord(s); return delivered(s) && r.total > 0 && r.inside === r.total && Math.abs(leg(s, "flat")) <= FLAT_BAND; },
  passRuleText: "Hedge ratio within 10% of one at every close with exposure, flat leg inside the band, cargo delivered.",
  quiz,
  par: -242888.68, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
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
    const v = voyageOf(s, c);
    if (c && v && v.status === "laden" && v.anchorUntil === null) { const days = anchorDaysForQueue(s, c); if (days > 0) return [{ type: "instruct_ship", player: P, cargoId: c.id, anchorDays: days }]; }
    // keep the paper matched to the unpriced barrels as they will stand at the close, in the second month (the front expires mid-voyage)
    if (c && isOpen(s)) {
      const o = hedgeChunk("BRENT", second(s), hedgeAdjustment(s));
      if (o) return [o];
    }
    return [];
  },
};

export const level06Ratio = hedgeRatio;
