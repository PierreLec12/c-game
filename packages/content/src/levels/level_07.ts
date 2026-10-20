import { legMark, type LevelSpec, type QuizQuestion, type State } from "@desk/engine";
import { P, accept, cargo0, fixCheapest, hedgeChunk, isOpen, leg, openBids, openOffers, quizAnswers, refFor, unpricedShare, usd, TIER2_LIMITS, TIER2_UNLOCKS } from "../bot";
import { askMentorTier1, tier1Mentor } from "../mentor";

const delivered = (s: State) => s.cargoes.some((c) => c.status === "delivered");
const soldEast = (s: State) => s.cargoes.some((c) => c.sale && c.sale.basis === "DUBAI");
const claimHandled = (s: State) => s.cargoes.some((c) => c.claims.some((k) => k.status !== "open"));
const claimRaised = (s: State) => s.cargoes.some((c) => c.claims.length > 0);

/** Dubai-swap lots held against the unpriced Dubai sale, as a ratio; null when there is no such exposure yet. */
export function ewRatio(s: State): number | null {
  const c = s.cargoes.find((x) => x.sale && x.sale.basis === "DUBAI");
  if (!c || c.purchase.fixed === null) return null;
  const exposure = c.bbl * unpricedShare(s, c, "sale");
  if (exposure < 100000) return null;
  const dub = s.lots.filter((l) => l.inst === "DUBAI").reduce((a, l) => a + l.qty, 0) * 1000;
  return -dub / exposure;
}

/** Closes after the purchase priced and before the Dubai sale priced: the Dubai swap should cover the unpriced sale. */
function ewRecord(s: State): { inside: number; total: number } {
  const c = s.cargoes.find((x) => x.sale && x.sale.basis === "DUBAI");
  if (!c || !c.purchase.windowDays) return { inside: 0, total: 0 };
  const purchaseDone = Math.max(...c.purchase.windowDays) * 24 + 19;
  const saleStart = c.sale!.windowDays ? Math.min(...c.sale!.windowDays) * 24 : Infinity;
  let inside = 0, total = 0;
  for (const k of s.risk.closes) {
    if (k.tick <= purchaseDone || k.tick >= saleStart) continue;
    total += 1;
    const ratio = -(k.net.DUBAI * 1000) / c.bbl;
    if (Math.abs(ratio - 1) <= 0.2) inside += 1;
  }
  return { inside, total };
}

function quiz(s: State): QuizQuestion[] {
  const c = s.cargoes[0];
  return [
    { id: "q1", text: `You bought on Dated and sold on Dubai. Between the purchase pricing and the sale pricing you were exposed to:`, choices: ["Nothing: both are crude", "The Brent-Dubai (East-West) spread on the unpriced sale, on top of the flat price", "Only the freight", "The WTI spread"], correct: 1, explanation: "A sale on Dubai is long Dubai; Brent futures hedge Brent. The gap is the East-West spread, hedged with the Dubai swap." },
    { id: "q2", text: c ? `The ${c.grade === "BONNY_LIGHT" ? "Bonny Light" : "grade"} differential moved ${(s.factors.gradeDiffs[c.grade] - c.purchase.diff).toFixed(2)} against your purchase differential while the cargo was unsold. An unsold cargo is:` : "An unsold cargo is:", choices: ["Flat", "Long the grade differential as well as the flat price", "Short the differential", "Only exposed at discharge"], correct: 1, explanation: "Until it is sold, the cargo is marked at the market differential; selling fixes it." },
    { id: "q3", text: "An EFP:", choices: ["Crosses the spread twice", "Fixes the unpriced days at the assessment and hands over matching futures at the same price, no spread crossed", "Is a futures roll", "Is a type of demurrage"], correct: 1, explanation: "Exchange of futures for physical: paper and barrels change hands together." },
    { id: "q4", text: "The inspector found the sulphur off-spec at discharge. The right first question is:", choices: ["Whether the receiver is bluffing", "What the claim costs against what contesting costs, given the inspector's record", "Whether to sue the producer", "Whether to abandon the cargo"], correct: 1, explanation: "A claim is a price. Settling it costs the claim; contesting costs a re-test and the receiver's costs if you lose." },
  ];
}

export const level07: LevelSpec = {
  id: 7, tier: 2, title: "Basis and quality", subtitle: "Dated versus futures, a differential that moves against you, a sale East on Dubai, an EFP, and a claim",
  days: 45, startDate: "2027-03-01", capital: 20e6, creditLine: 150e6, lives: 3,
  instruments: ["BRENT", "DUBAI"], unlocks: TIER2_UNLOCKS,
  regime: "normal", world: { oecdInvGap: -4, crudeBalance: 0, geo: 0.25 }, factors: { brentRef: refFor(76, -4, 0.25) },
  limits: { var95: 4e6, netLots: TIER2_LIMITS(1200), grossLots: 2400, stopLoss: 5e6, drawdown: 6e6, concentration: 1 },
  events: [
    { id: "offer", kind: "tender", day: 0, hour: 9, params: { counterparty: "DELTA_INDEPENDENT", side: "offer", grade: "BONNY_LIGHT", incoterm: "FOB", port: "BONNY", windowKind: "after_bl", windowDays: 5, laycanStart: 4, laycanDays: 2, openHours: 72, diffVsFair: -0.15, note: "Delta Independent offers a Suezmax of Bonny Light FOB Bonny, laycan days 4-6, Dated plus the differential shown (cheap: they need the cash), pricing 5 days after B/L." } },
    { id: "diff", kind: "grade_diff_shock", day: 8, hour: 11, params: { grade: "BONNY_LIGHT", delta: -0.8, headline: "Bonny Light differential weakens 80 cents as Nigerian loadings rise", body: "More West African cargoes on offer this month than Europe wants. An unsold Bonny cargo is worth 80 cents a barrel less than it was this morning." } },
    { id: "bid", kind: "tender", day: 6, hour: 10, params: { counterparty: "EASTERN_PACIFIC", side: "bid", grade: "BONNY_LIGHT", incoterm: "DES", port: "JAMNAGAR", basis: "DUBAI", windowKind: "after_discharge", windowDays: 5, laycanStart: 30, laycanDays: 6, openHours: 72, note: "Eastern Pacific bids for a Bonny Light cargo DES Jamnagar, discharge days 30-36, Dubai plus the differential shown, pricing 5 days after discharge." } },
    { id: "claim", kind: "quality_claim", day: 30, hour: 9, params: { usdPerBbl: 0.3, text: "Sulphur tested 0.21% against the 0.15% in the contract." } },
  ],
  briefing: `Forty-five days. Delta Independent is offering Bonny Light FOB Bonny cheap, pricing five days after B/L. Eastern Pacific will bid for it DES Jamnagar, priced on Dubai. Brent futures hedge Brent; the sale is Dubai. The gap is the East-West spread, and the Dubai swap is listed.

The Bonny differential will not wait for you: an unsold cargo is long the differential. At discharge the inspector will have something to say about the sulphur.

Use an EFP to fix a leg when you have paper against it. Pass: cargo sold East with the East-West exposure hedged with the swap (or explained in the debrief), the claim handled, cargo delivered.`,
  objectives: [
    { id: "delivered", text: "Deliver the cargo", check: (s) => (delivered(s) ? "done" : s.level.status === "running" ? "pending" : "failed") },
    { id: "east", text: "Sell the cargo East, priced on Dubai", check: (s) => (soldEast(s) ? "done" : "pending") },
    { id: "ew", text: "Dubai swap against the unpriced Dubai sale at every close with that exposure (within 20%)", check: (s) => { const r = ewRecord(s); return r.total === 0 ? "pending" : r.inside >= r.total * 0.9 ? "done" : "failed"; }, detail: (s) => { const r = ewRecord(s); return `${r.inside} of ${r.total} closes inside`; } },
    { id: "claim", text: "Handle the quality claim", check: (s) => (claimHandled(s) ? "done" : claimRaised(s) ? "pending" : "pending") },
  ],
  cards: [
    { id: "basis_risk", trigger: () => true },
    { id: "why_dubai", trigger: (s) => s.tenders.some((t) => t.basis === "DUBAI") },
    { id: "efp", trigger: (s) => s.cargoes.some((c) => c.purchase.fixed !== null) },
  ],
  mentor: (s, ev) => {
    const lines = tier1Mentor(s, ev);
    if (s.tick === 0 && ev.length === 0) lines.push("Cheap for a reason, sometimes. The differential is a price of its own. And when the sale is on Dubai, your Brent hedge is only most of the hedge.");
    if (ev.some((e) => e.text.includes("differential weakens"))) lines.push("Eighty cents on a million barrels. If the cargo was unsold, that was yours.");
    if (ev.some((e) => e.kind === "claim" && e.text.startsWith("Quality claim"))) lines.push("The inspector's number is a price. Settle it or pay to contest it; do the arithmetic before the pride.");
    return lines;
  },
  askMentor: askMentorTier1,
  pass: (s) => delivered(s) && soldEast(s) && claimHandled(s),
  passRuleText: "Cargo sold East on Dubai and delivered, the claim handled, the East-West exposure hedged or explained in the debrief.",
  quiz,
  par: -869849.04, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
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
    const claim = c?.claims.find((k) => k.status === "open");
    if (c && claim) return [{ type: "settle_claim", player: P, cargoId: c.id, claimId: claim.id }];
    if (!c || !isOpen(s)) return [];
    // flat: Brent futures against the unpriced purchase (short) and the unsold or unpriced sale (long), as they stand at the close
    const today = Math.floor(s.tick / 24);
    const leftShare = (which: "purchase" | "sale") => { const l = which === "purchase" ? c.purchase : c.sale; if (!l) return 0; const m = legMark(s, c, l); return m.unpriced.length / m.n; };
    void today;
    const physBrent = -c.bbl * leftShare("purchase") + (c.sale ? 0 : c.bbl);
    const heldB = s.lots.filter((l) => l.inst === "BRENT").reduce((a, l) => a + l.qty, 0);
    const oB = hedgeChunk("BRENT", s.listed.BRENT[1], Math.round((-physBrent - heldB * 1000) / 1000));
    if (oB) return [oB];
    // East-West: the Dubai sale is hedged with the swap in the month of its window
    if (c.sale && c.sale.basis === "DUBAI") {
      const exposure = c.bbl * leftShare("sale");
      const heldD = s.lots.filter((l) => l.inst === "DUBAI").reduce((a, l) => a + l.qty, 0);
      const month = s.listed.DUBAI[Math.min(1, s.listed.DUBAI.length - 1)];
      const oD = hedgeChunk("DUBAI", month, Math.round((-exposure - heldD * 1000) / 1000));
      if (oD) return [oD];
      // once the sale window is anchored, fix the remainder with an EFP after the first print
      if (c.sale.windowDays && c.sale.fixed === null && Object.keys(c.sale.prints).length >= 1 && c.sale.fixed === null && Math.abs(heldD) > 0) return [{ type: "efp", player: P, cargoId: c.id, leg: "sale" }];
    }
    return [];
  },
};
