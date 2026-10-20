import { passageOptions, type LevelSpec, type QuizQuestion, type State } from "@desk/engine";
import { P, accept, anchorDaysForQueue, cargo0, fixCheapest, hedgeAdjustment, hedgeChunk, isOpen, leg, openBids, openOffers, quizAnswers, refFor, usd, voyageOf, TIER2_LIMITS, TIER2_UNLOCKS } from "../bot";
import { askMentorTier1, tier1Mentor } from "../mentor";

const delivered = (s: State) => s.cargoes.some((c) => c.status === "delivered");
const demurrageUnderADay = (s: State) => s.cargoes.every((c) => { const v = s.voyages.find((x) => x.id === c.voyageId); return !v || c.demurrageUsd < v.hireUsdPerDay; });
const decidedWell = (s: State) => s.voyages.some((v) => v.decision && (v.decision.choice === "proceed" ? v.decision.proceedUsd <= v.decision.rerouteUsd * 1.1 : v.decision.rerouteUsd <= v.decision.proceedUsd * 1.1));

function quiz(s: State): QuizQuestion[] {
  const v = s.voyages[0];
  const fr = leg(s, "freight");
  return [
    { id: "q1", text: `Your freight leg (charter, war risk, detour) was ${usd(fr)}. Freight on a Suezmax from the Gulf to Rotterdam is, per barrel:`, choices: ["About a tenth of the price of oil", "A dollar or two: a share of the barrel you can compute from hire times days over barrels", "Zero under FOB", "Paid by the receiver"], correct: 1, explanation: "Lump sum over barrels. On a million barrels a $1.5m charter is $1.50 a barrel." },
    { id: "q2", text: v?.decision ? `At ${v.decision.chokepoint.replace("_", " ")} you chose to ${v.decision.choice}: ${usd(v.decision.proceedUsd)} to transit against ${usd(v.decision.rerouteUsd)} to go round. A restricted passage is:` : "A restricted passage is:", choices: ["A freight shock only", "A freight shock and a time spread at once: later barrels at the destination, dearer ships everywhere", "A reason to sell the cargo", "Irrelevant to a cargo already at sea"], correct: 1, explanation: "Tonne-miles rise and the barrels arrive later: hire and the prompt reprice together." },
    { id: "q3", text: `The front Brent spread is ${s.factors.spread1.BRENT.toFixed(2)} a month. A ship at anchor off the discharge port:`, choices: ["Always loses money", "Earns if the contango per day exceeds the hire per barrel per day", "Is free", "Counts as demurrage"], correct: 1, explanation: "Storage on water pays when the curve pays more than the ship costs." },
    { id: "q4", text: "Demurrage starts:", choices: ["When the ship sails", "When laytime at the port is used up after notice of readiness", "At the B/L", "Never under CIF"], correct: 1, explanation: "Laytime is the allowance; beyond it the charterer pays the ship's hire for the wait." },
  ];
}

export const level09: LevelSpec = {
  id: 9, tier: 2, title: "Freight and chokepoints", subtitle: "A Gulf VLCC to Rotterdam; the Red Sea is restricted mid-voyage",
  days: 45, startDate: "2027-03-01", capital: 20e6, creditLine: 150e6, lives: 3,
  instruments: ["BRENT"], unlocks: TIER2_UNLOCKS,
  regime: "normal", world: { oecdInvGap: 18, crudeBalance: 100, geo: 0.3 }, factors: { brentRef: refFor(74, 18, 0.3) },
  limits: { var95: 5e6, netLots: TIER2_LIMITS(2500), grossLots: 5000, stopLoss: 6e6, drawdown: 7e6, concentration: 50 },
  events: [
    { id: "offer", kind: "tender", day: 0, hour: 9, params: { counterparty: "GULF_NATIONAL", side: "offer", grade: "ARAB_LIGHT", bbl: 1000000, incoterm: "FOB", port: "RAS_TANURA", basis: "DATED", windowKind: "after_bl", windowDays: 5, laycanStart: 3, laycanDays: 2, openHours: 60, note: "Gulf National offers a Suezmax of Arab Light FOB Ras Tanura, laycan days 3-5, Dated plus the differential shown, pricing 5 days after B/L." } },
    { id: "bid", kind: "tender", day: 1, hour: 10, params: { counterparty: "RHINE_REFINING", side: "bid", grade: "ARAB_LIGHT", bbl: 1000000, incoterm: "CIF", port: "ROTTERDAM", basis: "DATED", windowKind: "after_discharge", windowDays: 5, laycanStart: 28, laycanDays: 12, openHours: 96, note: "Rhine Refining bids for an Arab Light cargo CIF Rotterdam, discharge days 28-40, Dated plus the differential shown, pricing 5 days after discharge." } },
    { id: "redsea", kind: "chokepoint", day: 9, hour: 9, params: { id: "BAB_EL_MANDEB", status: "restricted", headline: "Red Sea restricted: attacks on shipping off Bab el-Mandeb", body: "Insurers withdraw cover for the southern Red Sea. Transits wait for escorted convoys and pay a war-risk premium; the alternative is the Cape, two weeks longer. Freight and the East-West spread jump." } },
    { id: "reopen", kind: "chokepoint", day: 30, hour: 9, params: { id: "BAB_EL_MANDEB", status: "open", headline: "Red Sea passage reopens", body: "Convoys stand down; the premium fades." } },
  ],
  briefing: `Forty-five days. A Suezmax of Arab Light from Ras Tanura to Rotterdam via Suez: twenty-odd days at sea. Rhine Refining's discharge window is wide. The curve is in contango, so a late barrel is not a cheap barrel.

Somewhere in the Gulf of Aden the Red Sea will be restricted. The ship will stop at Bab el-Mandeb and ask you: pay war risk and wait for a convoy, or go round the Cape. The callout on the Map gives both costs; the curve tells you what the delay is worth.

Pass: deliver the cargo with the freight leg inside par (the cheaper passage, within 10%), demurrage under one day.`,
  objectives: [
    { id: "delivered", text: "Deliver the cargo", check: (s) => (delivered(s) ? "done" : s.level.status === "running" ? "pending" : "failed") },
    { id: "passage", text: "Choose the cheaper passage (within 10%) when the Red Sea is restricted", check: (s) => (s.voyages.some((v) => v.decision) ? (decidedWell(s) ? "done" : "failed") : "pending") },
    { id: "demurrage", text: "Demurrage under one day", check: (s) => (!demurrageUnderADay(s) ? "failed" : delivered(s) ? "done" : "pending") },
  ],
  cards: [
    { id: "freight_share", trigger: () => true },
    { id: "chokepoint_is_a_spread", trigger: (s) => Object.values(s.chokepoints).some((c) => c.status !== "open") },
    { id: "storage_on_water", trigger: (s) => s.cargoes.some((c) => c.blTick !== null) },
  ],
  mentor: (s, ev) => {
    const lines = tier1Mentor(s, ev);
    if (s.tick === 0 && ev.length === 0) lines.push("A million barrels and twenty days of sea. The ship is a share of the barrel; keep the share small and the days honest.");
    if (ev.some((e) => e.kind === "chokepoint" && e.text.includes("holding"))) lines.push("The ship is waiting on you. Convoy and premium, or the Cape. Price both, then add what the curve pays or charges for the extra days.");
    if (ev.some((e) => e.kind === "claim" && e.text.startsWith("Demurrage"))) lines.push("Demurrage. The berth was not ready and the clock was. Slow down next time.");
    return lines;
  },
  askMentor: askMentorTier1,
  pass: (s) => delivered(s) && decidedWell(s) && demurrageUnderADay(s),
  passRuleText: "Cargo delivered, the cheaper passage chosen within 10%, demurrage under one day.",
  quiz,
  par: -1025135.86, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
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
    if (c && v && v.status === "waiting_chokepoint" && v.waitUntil === null) {
      const o = passageOptions(s, v);
      // the curve's view of the extra days: contango pays for delay, backwardation charges for it
      const perDay = (s.factors.spread1.BRENT / 30.4375) * c.bbl;
      const proceed = o.proceed.costUsd - o.proceed.extraDays * perDay;
      const reroute = o.reroute ? o.reroute.costUsd - o.reroute.extraDays * perDay : Infinity;
      return [{ type: "instruct_ship", player: P, cargoId: c.id, passage: proceed <= reroute ? "proceed" : "reroute" }];
    }
    if (c && v && v.status === "laden" && v.anchorUntil === null) { const days = anchorDaysForQueue(s, c); if (days > 0) return [{ type: "instruct_ship", player: P, cargoId: c.id, anchorDays: days }]; }
    if (c && isOpen(s)) {
      const o = hedgeChunk("BRENT", s.listed.BRENT[1], hedgeAdjustment(s));
      if (o) return [o];
    }
    return [];
  },
};
