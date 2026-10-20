import { tankInventory, type LevelSpec, type QuizQuestion, type State } from "@desk/engine";
import { P, accept, cargo0, hedgeAdjustment, hedgeChunk, isOpen, leg, levelDay, openBids, openOffers, quizAnswers, refFor, usd, TIER3_LIMITS, TIER3_UNLOCKS } from "../bot";
import { askMentorTier1, tier1Mentor } from "../mentor";

const STORAGE_BAND = 450000; // USD: 500 kb for about two months at Cushing, stylised
const FLIP_DAY = 35;
const carryLocked = (s: State) => s.tanks.some((t) => t.parcels.length > 0 || s.cargoes.some((c) => c.tankId === t.id)) && s.fills.some((f) => f.inst === "WTI" && f.side === "sell" && f.tag === "hedge");
const unwound = (s: State) => s.tanks.length > 0 && s.tanks.every((t) => tankInventory(t) === 0) && s.lots.filter((l) => l.inst === "WTI").reduce((a, l) => a + l.qty, 0) === 0 && s.cargoes.some((c) => c.sale);
const storedParcelBbl = (s: State) => s.tanks.reduce((a, t) => a + tankInventory(t), 0);

function quiz(s: State): QuizQuestion[] {
  return [
    { id: "q1", text: `Your storage leg was ${usd(leg(s, "storage"))} and your time-spread leg ${usd(leg(s, "time_spread"))}. A cash-and-carry earns:`, choices: ["The flat price going up", "The contango, less storage and the interest on the money, locked the day the deferred leg is sold", "Freight", "The differential"], correct: 1, explanation: "Buy prompt, store, sell deferred: the structure is the revenue; the tank and the line are the costs." },
    { id: "q2", text: "When the curve flipped to backwardation the stored barrel became:", choices: ["Worthless", "Worth more than the deferred paper against it: time to sell the oil and buy back the paper", "A loss", "Unhedged"], correct: 1, explanation: "In backwardation the prompt is dearest; carrying costs money every day from here. Unwind." },
    { id: "q3", text: "A tank lease charges:", choices: ["Per barrel stored, daily", "Per barrel of capacity, monthly, with a minimum term paid out if you leave early", "Only when full", "Nothing at Cushing"], correct: 1, explanation: "Capacity, not contents; the minimum term is the landlord's own carry." },
    { id: "q4", text: "Blending a sweet parcel into a sour one:", choices: ["Always adds value", "Prices the result on the quality grid: it pays when the grid rewards the sulphur cut more than the sweet premium you gave up", "Is illegal", "Changes the benchmark"], correct: 1, explanation: "A blend is a cheaper barrel only if someone buys that quality." },
  ];
}

export const level13: LevelSpec = {
  id: 13, tier: 3, title: "Storage and carry", subtitle: "Deep contango at Cushing: lease, fill, sell deferred, and unwind when the curve flips",
  days: 60, startDate: "2027-03-01", capital: 50e6, creditLine: 400e6, lives: 3,
  instruments: ["BRENT", "WTI"], unlocks: TIER3_UNLOCKS, infoDelayHours: 12,
  regime: "normal", world: { oecdInvGap: 25, usInvGap: 60, crudeBalance: 100 }, factors: { brentRef: refFor(68, 25) },
  limits: { var95: 5e6, netLots: TIER3_LIMITS(2000, 2000), grossLots: 5000, stopLoss: 8e6, drawdown: 10e6, concentration: 50 },
  events: [
    { id: "offer", kind: "tender", day: 0, hour: 9, params: { counterparty: "DELTA_INDEPENDENT", side: "offer", grade: "WTI_MIDLAND", bbl: 500000, incoterm: "DES", port: "CUSHING", basis: "WTI", windowKind: "after_bl", windowDays: 3, laycanStart: 2, laycanDays: 1, openHours: 48, note: "Delta Independent offers 500,000 bbl of WTI Midland in tank at Cushing, transfer on day 2, WTI plus the differential shown, pricing 3 days after transfer." } },
    { id: "sour", kind: "tender", day: 0, hour: 10, params: { counterparty: "GULF_COAST_REFINING", side: "offer", grade: "ARAB_LIGHT", bbl: 100000, incoterm: "DES", port: "CUSHING", basis: "WTI", windowKind: "after_bl", windowDays: 3, laycanStart: 2, laycanDays: 1, openHours: 48, diffVsFair: -0.6, note: "Gulf Coast Refining offers a 100,000 bbl sour parcel at Cushing, cheap, for anyone with a tank and a blend in mind." } },
    { id: "rumour", kind: "rumour", day: 20, hour: 10, params: { headline: "Rumour: Cushing outbound pipeline to resume early", moveNow: 0.012, resolveHours: 36, pTrue: 0.5, eventKind: "inventory_shock", eventParams: "{\"usInvGap\":-20,\"headline\":\"Cushing pipeline back: stocks drain\"}" } },
    { id: "flip", kind: "inventory_shock", day: FLIP_DAY, hour: 9, params: { usInvGap: -75, headline: "Cushing draws hard: the hub's outbound lines reverse and the curve flips", body: "The surplus at Cushing is gone in a fortnight. Prompt barrels are worth more than deferred ones now; storage no longer pays." } },
    { id: "prompt1", kind: "tender", day: 36, hour: 10, params: { counterparty: "GULF_COAST_REFINING", side: "bid", grade: "WTI_MIDLAND", bbl: 500000, incoterm: "DES", port: "CUSHING", basis: "WTI", windowKind: "deemed", windowDays: 3, deemedDay: 38, laycanStart: 38, laycanDays: 3, openHours: 72, note: "Gulf Coast Refining bids for 500,000 bbl of WTI Midland in tank at Cushing, pricing 3 days from day 38." } },
    { id: "prompt2", kind: "tender", day: 44, hour: 10, params: { counterparty: "GULF_COAST_REFINING", side: "bid", grade: "WTI_MIDLAND", bbl: 500000, incoterm: "DES", port: "CUSHING", basis: "WTI", windowKind: "deemed", windowDays: 3, deemedDay: 46, laycanStart: 46, laycanDays: 3, openHours: 72 } },
  ],
  briefing: `Sixty days and Cushing is full: the WTI curve is in deep contango. Lease a tank on the Desk, take Delta's 500,000 barrels in tank, and sell the deferred month against it with WTI futures: the contango is yours, less the lease and the interest. Read the carry on the card before you do it.

Around day 35 the hub's outbound lines reverse and the curve flips. From there storage costs money every day: sell the oil into the prompt bid, buy back the paper, release the tank. A sour parcel is on offer too, cheap, if you want to try a blend.

Pass: a carry locked (oil in tank, deferred paper sold), unwound after the flip with the tank empty and the paper flat, profitable, storage leg inside ${usd(STORAGE_BAND)}.`,
  objectives: [
    { id: "locked", text: "Carry locked: oil in a tank with deferred WTI sold against it", check: (s) => (carryLocked(s) ? "done" : "pending") },
    { id: "unwound", text: "Unwound: tank empty and WTI paper flat by the end", check: (s) => (unwound(s) ? "done" : s.level.status === "running" ? "pending" : "failed") },
    { id: "profit", text: "The carry made money", check: (s) => (s.level.status === "running" ? (s.pnl.total > 0 ? "done" : "pending") : s.pnl.total > 0 ? "done" : "failed"), detail: (s) => `P&L ${usd(s.pnl.total)}` },
    { id: "storage", text: `Storage leg inside ${usd(STORAGE_BAND)}`, check: (s) => (Math.abs(leg(s, "storage")) > STORAGE_BAND ? "failed" : s.level.status === "running" ? "pending" : "done"), detail: (s) => `storage leg ${usd(leg(s, "storage"))}` },
  ],
  cards: [
    { id: "cash_and_carry", trigger: () => true },
    { id: "storage_economics", trigger: (s) => s.tanks.length > 0 },
    { id: "blending_to_spec", trigger: (s) => s.tanks.some((t) => t.parcels.length > 0) },
  ],
  mentor: (s, ev) => {
    const lines = tier1Mentor(s, ev);
    if (s.tick === 0 && ev.length === 0) lines.push("Cushing is full and the curve is paying you to hold oil. Lease the tank, take the barrels, sell the deferred month. Then watch for the day the curve stops paying.");
    if (ev.some((e) => e.text.includes("curve flips"))) lines.push("Flipped. Every day in the tank costs you from here. Sell the prompt, buy back the paper, give the tank back.");
    if (ev.some((e) => e.kind === "rumour")) lines.push("A rumour, half the time true. The curve moved on it; the tank did not. Wait for the confirmation before you unwind on a story.");
    return lines;
  },
  askMentor: askMentorTier1,
  pass: (s) => carryLocked(s) && unwound(s) && s.pnl.total > 0 && Math.abs(leg(s, "storage")) <= STORAGE_BAND,
  passRuleText: `Carry locked and unwound after the flip, profitable, storage leg inside ${usd(STORAGE_BAND)}, and a correct debrief.`,
  quiz,
  par: 52561.91, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
  seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  solve: (s) => {
    if (s.level.status === "ended") return quizAnswers(s);
    if (s.level.status !== "running") return [];
    const d = levelDay(s);
    if (s.tanks.length === 0) return [{ type: "lease_tank", player: P, port: "CUSHING", bbl: 500000, months: 2 }];
    const tank = s.tanks[0];
    const offer = openOffers(s).find((t) => t.grade === "WTI_MIDLAND");
    if (offer && !cargo0(s)) return [accept(offer.id)];
    const sour = openOffers(s).find((t) => t.grade === "ARAB_LIGHT");
    if (sour) return [{ type: "decline_tender", player: P, tenderId: sour.id, reason: "no buyer for a sour blend at Cushing this month" }];
    const c = cargo0(s);
    if (c && c.status === "delivered" && !c.tankId && !c.sale) return [{ type: "store_cargo", player: P, cargoId: c.id, tankId: tank.id }];
    const heldW = s.lots.filter((l) => l.inst === "WTI").reduce((a, l) => a + l.qty, 0);
    // after the flip: sell the oil into the prompt bid; the hedge then unwinds as the sale prices, and the tank goes back
    if (d >= FLIP_DAY) {
      const bid = openBids(s).find((t) => t.grade === "WTI_MIDLAND");
      if (bid && c && c.tankId && !c.sale) return [accept(bid.id, c.id)];
      if (c && c.sale && heldW === 0 && !tank.released && tankInventory(tank) === 0 && c.sale.paidTick !== null) return [{ type: "release_tank", player: P, tankId: tank.id }];
    }
    // the paper: the deferred month against the net physical barrels (stored oil long, unpriced purchase short, unpriced sale long)
    if (isOpen(s)) {
      const month = s.lots.find((l) => l.inst === "WTI")?.month ?? s.listed.WTI[Math.min(2, s.listed.WTI.length - 1)];
      const o = hedgeChunk("WTI", month, hedgeAdjustment(s, "WTI"));
      if (o) return [o];
    }
    void storedParcelBbl;
    return [];
  },
};
