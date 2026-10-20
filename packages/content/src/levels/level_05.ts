import type { LevelSpec, QuizQuestion, State } from "@desk/engine";
import { P, accept, anchorDaysForQueue, cargo0, fixCheapest, hour, leg, levelDay, openBids, openOffers, quizAnswers, refFor, usd, voyageOf, TIER2_LIMITS, TIER2_UNLOCKS } from "../bot";
import { askMentorTier1, tier1Mentor } from "../mentor";

const delivered = (s: State) => s.cargoes.some((c) => c.status === "delivered");
const noDemurrage = (s: State) => s.cargoes.every((c) => c.demurrageUsd === 0);

function quiz(s: State): QuizQuestion[] {
  const flat = leg(s, "flat"), basis = leg(s, "basis"), freight = leg(s, "freight"), ts = leg(s, "time_spread");
  const biggest = [["flat price", flat], ["basis", basis], ["freight", freight], ["time spread", ts]].sort((a, b) => Math.abs(b[1] as number) - Math.abs(a[1] as number))[0][0] as string;
  const idx = ["flat price", "basis", "freight", "time spread"].indexOf(biggest);
  return [
    { id: "q1", text: `Your legs: flat price ${usd(flat)}, basis ${usd(basis)}, freight ${usd(freight)}, time spread ${usd(ts)}. Which leg was the largest in absolute terms?`, choices: ["flat price", "basis", "freight", "time spread"], correct: idx, explanation: "An unhedged cargo lives and dies on the flat price between the purchase window and the sale window; the differentials and freight are the margin, the flat price is the risk." },
    { id: "q2", text: "Between the purchase window printing and the sale window printing, an unhedged cargo is:", choices: ["Flat: the price is fixed", "Long the flat price: the cost is known, the revenue is not", "Short the flat price", "Only exposed to freight"], correct: 1, explanation: "Once the purchase has priced you own barrels at a known cost; until the sale prices, every dollar of flat price is yours." },
    { id: "q3", text: "Under FOB Sullom Voe, who fixes the ship and pays the freight?", choices: ["The seller", "You, the buyer", "The receiver in Rotterdam", "The inspector"], correct: 1, explanation: "FOB ends the seller's job at the load port rail; the buyer carries the oil, the ship and the risk at sea." },
    { id: "q4", text: "The bill of lading matters because:", choices: ["It is the invoice", "Its date anchors the pricing window and the oil becomes yours", "It sets the freight rate", "It is signed at discharge"], correct: 1, explanation: "Everything downstream counts from the B/L: the window, the invoice, the hedge." },
  ];
}

export const level05: LevelSpec = {
  id: 5, tier: 2, title: "First cargo, unhedged on purpose", subtitle: "Buy a cargo, fix the ship, sell it, and watch the flat price do what it does",
  days: 30, startDate: "2027-03-01", capital: 20e6, creditLine: 150e6, lives: 3,
  instruments: ["BRENT"], unlocks: TIER2_UNLOCKS.filter((u) => !["order", "spread", "roll", "efp"].includes(u)),
  regime: "normal", world: { oecdInvGap: -6, crudeBalance: 0 }, factors: { brentRef: refFor(75, -6) },
  limits: { var95: 4e6, netLots: TIER2_LIMITS(700), grossLots: 1400, stopLoss: 8e6, drawdown: 9e6, concentration: 50 },
  events: [
    { id: "offer", kind: "tender", day: 0, hour: 9, params: { counterparty: "NORTHSEA_MAJOR", side: "offer", grade: "FORTIES", incoterm: "FOB", port: "SULLOM_VOE", windowKind: "after_bl", windowDays: 5, laycanStart: 5, laycanDays: 2, openHours: 72, note: "Northsea Major offers one Aframax of Forties FOB Sullom Voe, laycan days 5-7, Dated plus the differential shown, pricing 5 days after B/L." } },
    { id: "bid", kind: "tender", day: 1, hour: 10, params: { counterparty: "RHINE_REFINING", side: "bid", grade: "FORTIES", incoterm: "CIF", port: "ROTTERDAM", windowKind: "after_discharge", windowDays: 5, laycanStart: 9, laycanDays: 4, openHours: 120, note: "Rhine Refining bids for a Forties cargo CIF Rotterdam, discharge days 9-13, Dated plus the differential shown, pricing 5 days after discharge." } },
    { id: "move", kind: "headline_move", day: 11, hour: 10, params: { pct: -0.05, headline: "OPEC+ surprises with an output increase; Brent drops 5%", body: "Nobody saw it coming. If you own barrels that are not yet priced, you just found out what that means." } },
    { id: "jam", kind: "port_congestion", day: 7, hour: 9, params: { port: "ROTTERDAM", hours: 60, headline: "Rotterdam: berth congestion, two to three day queue", body: "Ships arriving now wait for a berth. Laytime is 36 hours; waiting beyond it is demurrage. A ship that slows down arrives when the queue has cleared." } },
  ],
  briefing: `Thirty days, your first cargo. Northsea Major is offering one Aframax of Forties FOB Sullom Voe at Dated plus a differential, pricing five days after the bill of lading. Rhine Refining will bid for it CIF Rotterdam, pricing five days after discharge. Accept the offer on the Desk, fix a ship from the quotes, accept the bid, and watch it sail on the Map.

You cannot hedge in this level. That is the point: between the purchase pricing and the sale pricing you are long 600,000 barrels of flat price, and Brent will move. Read the attribution afterwards and say where every dollar came from.

Watch the Rotterdam queue: a ship that waits past its laytime pays demurrage. Slow it down if the berth is not ready.

Pass: deliver the cargo, no demurrage, and a correct debrief.`,
  objectives: [
    { id: "cargo", text: "Buy the cargo and fix a ship", check: (s) => (s.cargoes.some((c) => c.vesselId) ? "done" : "pending") },
    { id: "sold", text: "Sell it CIF Rotterdam", check: (s) => (s.cargoes.some((c) => c.sale) ? "done" : "pending") },
    { id: "delivered", text: "Deliver it", check: (s) => (delivered(s) ? "done" : s.level.status === "running" ? "pending" : "failed") },
    { id: "demurrage", text: "No demurrage", check: (s) => (!noDemurrage(s) ? "failed" : delivered(s) ? "done" : "pending") },
  ],
  cards: [
    { id: "fob_cif_des", trigger: () => true },
    { id: "laycan_bl", trigger: (s) => s.cargoes.length > 0 },
    { id: "window_is_exposure", trigger: (s) => s.cargoes.some((c) => c.blTick !== null) },
  ],
  mentor: (s, ev) => {
    const lines = tier1Mentor(s, ev);
    if (s.tick === 0 && ev.length === 0) lines.push("Your first cargo. Buy it, fix the ship, sell it. Then do nothing, because you cannot. Watch what the flat price does to you between the two windows.");
    if (ev.some((e) => e.kind === "voyage" && e.text.startsWith("Bill of lading"))) lines.push("B/L signed. From here the purchase prices over five days and then you own barrels at a known cost with no sale price yet. Count the days.");
    if (ev.some((e) => e.text.includes("Brent drops 5%"))) lines.push("There it is. Six hundred thousand barrels times whatever that was. Level 6 gives you the tool.");
    if (ev.some((e) => e.text.includes("congestion"))) lines.push("A queue at Rotterdam. Thirty-six hours of laytime and then it is your money. The ship has a speed control.");
    return lines;
  },
  askMentor: askMentorTier1,
  pass: (s) => delivered(s) && noDemurrage(s),
  passRuleText: "Deliver the cargo, no demurrage, correct debrief.",
  quiz,
  par: -2357058.12, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
  seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  solve: (s) => {
    if (s.level.status === "ended") return quizAnswers(s);
    if (s.level.status !== "running") return [];
    const d = levelDay(s), h = hour(s);
    const c = cargo0(s);
    const offer = openOffers(s)[0];
    if (!c && offer) return [accept(offer.id)];
    if (c && !c.vesselId) { const f = fixCheapest(s, c); if (f) return [f]; }
    const bid = openBids(s)[0];
    if (c && bid && !c.sale) return [accept(bid.id, c.id)];
    // the queue: hold at anchor until the berth clears; notice of readiness only then, so laytime does not run in the queue
    const v = voyageOf(s, c);
    if (c && v && v.status === "laden" && v.anchorUntil === null) { const days = anchorDaysForQueue(s, c); if (days > 0) return [{ type: "instruct_ship", player: P, cargoId: c.id, anchorDays: days }]; }
    void d; void h;
    return [];
  },
};
