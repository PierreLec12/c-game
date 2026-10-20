import { listedStrikes, optionDeltaLots, OPTIONS, physicalExposureBbl, type LevelSpec, type QuizQuestion, type State } from "@desk/engine";
import { P, accept, cargo0, fixCheapest, hour, isOpen, leg, net, openBids, openOffers, quizAnswers, refFor, usd, varInsideEveryClose, TIER4_LIMITS, TIER4_UNLOCKS } from "../bot";
import { askMentorTier4, tier4Mentor } from "../mentor";

const NAKED_LIMIT = 200;
const DELTA_BAND = 60; // lots of net delta the book may carry after the programme
const PROGRAMME_DAY = 24;
const OPTION_CHUNK = 40; // option lots per order: the chain's depth, so slippage stays a spread

const putsOnCargo = (s: State): "pending" | "done" | "failed" => (s.fills.some((f) => f.option?.kind === "put" && f.side === "buy" && f.tag === "hedge") ? "done" : s.level.status === "running" ? "pending" : "failed");
const collarOnCargo = (s: State): "pending" | "done" | "failed" => (s.fills.some((f) => f.option?.kind === "call" && f.side === "sell" && f.tag === "hedge") ? "done" : s.level.status === "running" ? "pending" : "failed");
export function deltaRecord(s: State): { inside: number; total: number } {
  let inside = 0, total = 0;
  for (const c of s.risk.closes) {
    if (c.tick < PROGRAMME_DAY * 24 + 19) continue;
    const d = c.optionDeltaLots?.BRENT ?? 0;
    if (Math.abs(d) < 20) continue;
    total += 1;
    if (Math.abs(d + c.net.BRENT + (c.byBasis?.DATED ?? 0) / 1000 + (c.byBasis?.BRENT ?? 0) / 1000) <= DELTA_BAND) inside += 1;
  }
  return { inside, total };
}
const deltaHedged = (s: State): "pending" | "done" | "failed" => { const r = deltaRecord(s); if (s.level.status === "running") return r.total > 4 && r.inside / r.total < 0.5 ? "failed" : "pending"; return r.total > 0 && r.inside / r.total >= 0.75 ? "done" : "failed"; };
const nakedInside = (s: State): "pending" | "done" | "failed" => (s.risk.closes.some((c) => c.nakedShort > NAKED_LIMIT) || s.risk.breaches.some((b) => b.limit === "nakedShortOptions") ? "failed" : s.risk.closesTotal > 0 ? "done" : "pending");
const greeksShown = (s: State): "pending" | "done" | "failed" => { const g = new Set(s.pnl.attribution.filter((r) => r.leg === "options").map((r) => r.greek)); return g.has("delta") && g.has("vega") && g.has("theta") ? "done" : s.level.status === "running" ? "pending" : "failed"; };

function quiz(s: State): QuizQuestion[] {
  const vega = s.pnl.attribution.filter((r) => r.greek === "vega").reduce((a, r) => a + r.amount, 0);
  const theta = s.pnl.attribution.filter((r) => r.greek === "theta").reduce((a, r) => a + r.amount, 0);
  return [
    { id: "q1", text: "Black-76 prices an option on a future from:", choices: ["The future, the strike, the time to expiry and one volatility", "Interest rates alone", "The cargo's differential", "Last year's prices"], correct: 0, explanation: "Four inputs; the vol is the one the market argues about, and it is quoted a point wide." },
    { id: "q2", text: "A put on a long cargo and a collar on it differ in that:", choices: ["A collar has no floor", "The collar sells a call to pay for the put, giving up the upside above the call strike", "A put has no cost", "They are the same"], correct: 1, explanation: "The put is a floor you pay for; the collar pays for it with a ceiling." },
    { id: "q3", text: `When the producer bought ${300} puts from you, delta hedging meant:`, choices: ["Buying futures", "Selling futures equal to the puts' delta, and re-selling as the market fell because the delta grew: the hedge ratio moves", "Doing nothing", "Buying calls"], correct: 1, explanation: "Short puts are long delta. Gamma makes the delta grow as the market falls, so the hedge chases it." },
    { id: "q4", text: `Your vega leg was ${usd(vega)} and your theta leg ${usd(theta)}. On the day vol spiked:`, choices: ["Nothing happened to the options", "The short puts lost on vega before the future moved; the theta earned each day is the payment for carrying that", "Theta reversed", "Delta vanished"], correct: 1, explanation: "Vol is a price. A short option is short that price; time decay is the rent it collects for it." },
  ];
}

export const level16: LevelSpec = {
  id: 16, tier: 4, title: "Options", subtitle: "A put and a collar on a cargo; a producer's programme; delta hedging through a vol spike; theta",
  days: 45, startDate: "2027-06-07", capital: 50e6, creditLine: 400e6, lives: 3,
  instruments: ["BRENT", "WTI"], unlocks: TIER4_UNLOCKS, infoDelayHours: 24, backMonthDepth: 0.5,
  regime: "normal", world: { oecdInvGap: 0, crudeBalance: 0, geo: 0.25 }, factors: { brentRef: refFor(76, 0, 0.25) },
  limits: { var95: 4e6, netLots: TIER4_LIMITS({ BRENT: 1500, WTI: 500 }), grossLots: 4000, stopLoss: 8e6, drawdown: 10e6, concentration: 50, nakedShortOptions: NAKED_LIMIT },
  events: [
    { id: "offer", kind: "tender", day: 0, hour: 9, params: { counterparty: "NORTHSEA_MAJOR", side: "offer", grade: "FORTIES", bbl: 600000, incoterm: "FOB", port: "SULLOM_VOE", basis: "DATED", windowKind: "after_bl", windowDays: 5, laycanStart: 4, laycanDays: 1, openHours: 48 } },
    { id: "bid", kind: "tender", day: 1, hour: 10, params: { counterparty: "RHINE_REFINING", side: "bid", grade: "FORTIES", bbl: 600000, incoterm: "CIF", port: "ROTTERDAM", basis: "DATED", windowKind: "after_discharge", windowDays: 5, laycanStart: 11, laycanDays: 4, openHours: 72, diffVsFair: 0.1 } },
    { id: "inv1", kind: "inventory_release", day: 2, hour: 14 },
    { id: "inv2", kind: "inventory_release", day: 9, hour: 14 },
    { id: "inv3", kind: "inventory_release", day: 16, hour: 14 },
    { id: "prog", kind: "option_programme", day: PROGRAMME_DAY, hour: 10, params: { counterparty: "DELTA_INDEPENDENT", inst: "BRENT", monthIdx: 3, qty: 300, strikeOffset: -3 } },
    { id: "inv4", kind: "inventory_release", day: 30, hour: 14 },
    { id: "spike", kind: "vol_spike", day: 31, hour: 11, params: { intensity: 1.0, geo: 0.1, pct: -0.02, headline: "Missile strike on a Gulf export terminal; implied vol jumps a third" } },
    { id: "inv5", kind: "inventory_release", day: 37, hour: 14 },
  ],
  briefing: `Forty-five days with options on the book. A Forties cargo arrives on day 0 and Rhine bids for it on day 1: once the purchase has priced the sale leaves you long 600,000 barrels for a week. Hedge that with puts, then sell calls against them to make it a collar, and close the options when the sale prices.

On day ${PROGRAMME_DAY} Delta Independent runs its quarterly programme with you: it buys 300 Brent puts. You are short vega, short gamma, long theta and long the delta. Delta hedge by selling futures, and keep the naked short count under ${NAKED_LIMIT} lots at every close: the risk manager counts lots, not deltas. A week later vol spikes. Read the Greeks on the Book.

Pass: puts bought and a collar made on the cargo, the programme delta-hedged within ${DELTA_BAND} lots at three closes in four, never more than ${NAKED_LIMIT} naked short lots at a close, and delta, vega and theta all showing in the attribution.`,
  objectives: [
    { id: "put", text: "Puts bought against the long cargo (tagged hedge)", check: putsOnCargo },
    { id: "collar", text: "Calls sold against them: a collar", check: collarOnCargo },
    { id: "delta", text: `Programme delta-hedged within ${DELTA_BAND} lots at 75% of closes`, check: deltaHedged, detail: (s) => { const r = deltaRecord(s); return `${r.inside} of ${r.total} closes`; } },
    { id: "naked", text: `Never more than ${NAKED_LIMIT} naked short option lots at a close`, check: nakedInside },
    { id: "greeks", text: "Delta, vega and theta all shown in the attribution", check: greeksShown },
    { id: "var", text: "VaR inside the limit at every close", check: varInsideEveryClose },
  ],
  cards: [
    { id: "black76_one_screen", trigger: () => true },
    { id: "delta_moves", trigger: (s) => s.lots.some((l) => l.option) },
    { id: "vol_is_a_price", trigger: (s) => s.world.eventIntensity > 0.5 || s.pnl.attribution.some((r) => r.greek === "vega") },
  ],
  mentor: (s, ev) => {
    const lines = tier4Mentor(s, ev);
    if (s.tick === 0 && ev.length === 0) lines.push("An option is a hedge with a shape. Read Black-76 in one screen, then price a put on the chain before the cargo needs one.");
    if (ev.some((e) => e.kind === "option" && e.text.includes("programme"))) lines.push("You are short 300 puts. Long delta: sell futures for it. Short gamma: the hedge will be wrong after every move. Lindqvist counts naked lots: cover at least half with futures, whatever the delta says.");
    if (ev.some((e) => e.kind === "option" && e.text.includes("vol jumps"))) lines.push("Vol just repriced every option you hold. The delta hedge did nothing about that; it was never meant to.");
    return lines;
  },
  askMentor: askMentorTier4,
  pass: (s) => putsOnCargo(s) === "done" && collarOnCargo(s) === "done" && deltaHedged(s) === "done" && nakedInside(s) === "done" && greeksShown(s) === "done",
  passRuleText: `Puts and a collar on the cargo, the programme delta-hedged within ${DELTA_BAND} lots at 75% of closes, never more than ${NAKED_LIMIT} naked short lots at a close, the Greeks shown, and a correct debrief.`,
  quiz,
  par: -1920209.73, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
  seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  solve: (s) => {
    if (s.level.status === "ended") return quizAnswers(s);
    if (s.level.status !== "running") return [];
    const c = cargo0(s);
    const offer = openOffers(s)[0];
    if (!c && offer) return [accept(offer.id)];
    if (c && !c.vesselId && c.status === "contracted") { const f = fixCheapest(s, c); if (f) return [f]; }
    const bid = openBids(s)[0];
    if (c && bid && !c.sale) return [accept(bid.id, c.id)];
    if (!isOpen(s) || hour(s) < 8 || hour(s) > 16) return [];
    const month = s.listed.BRENT[2];
    const grid = listedStrikes(s, "BRENT", month);
    const mid = Math.floor(grid.length / 2);
    const exposure = c ? (physicalExposureBbl(s).byCargo[c.id] ?? 0) : 0;
    const hedgeLots = s.lots.filter((l) => l.option && l.tag === "hedge");
    const hedgePuts = hedgeLots.filter((l) => l.option!.kind === "put").reduce((a, l) => a + l.qty, 0);
    const hedgeCalls = hedgeLots.filter((l) => l.option!.kind === "call").reduce((a, l) => a + l.qty, 0);
    // the cargo: puts on the long barrels and calls sold against them (a collar), sized to the unpriced barrels and trimmed as the sale prints, in chunks the chain can take
    const wantLots = exposure >= 100000 ? Math.round(exposure / 1000) : 0;
    const putStrike = hedgeLots.find((l) => l.option!.kind === "put")?.option!.strike ?? grid[mid - 1];
    const callStrike = hedgeLots.find((l) => l.option!.kind === "call")?.option!.strike ?? grid[mid + 2];
    const putMonth = hedgeLots[0]?.month ?? month;
    const putAdj = wantLots - hedgePuts;
    if (grid.length && Math.abs(putAdj) >= 10) return [{ type: "option_order", player: P, inst: "BRENT", month: putMonth, strike: putStrike, kind: "put", side: putAdj > 0 ? "buy" : "sell", qty: Math.min(Math.abs(putAdj), OPTION_CHUNK), tag: "hedge" }];
    const callAdj = -wantLots - hedgeCalls;
    if (grid.length && hedgePuts > 0 && Math.abs(callAdj) >= 10) return [{ type: "option_order", player: P, inst: "BRENT", month: putMonth, strike: callStrike, kind: "call", side: callAdj > 0 ? "buy" : "sell", qty: Math.min(Math.abs(callAdj), OPTION_CHUNK), tag: "hedge" }];
    if (wantLots === 0 && hedgeCalls !== 0) return [{ type: "option_order", player: P, inst: "BRENT", month: putMonth, strike: callStrike, kind: "call", side: "buy", qty: Math.min(-hedgeCalls, OPTION_CHUNK), tag: "hedge" }];
    // the programme: delta hedge with futures, and at least enough short futures to keep the naked count inside the limit
    const shortPuts = s.lots.filter((l) => l.option?.kind === "put" && l.qty < 0 && l.tag !== "hedge").reduce((a, l) => a - l.qty, 0);
    if (shortPuts > 0) {
      const d = optionDeltaLots(s).BRENT ?? 0;
      const needCover = Math.max(0, shortPuts - NAKED_LIMIT + 10);
      const target = -Math.max(d, needCover);
      const held = net(s, "BRENT");
      const adj = Math.round(target - held);
      if (Math.abs(adj) >= 10) return [{ type: "order", player: P, inst: "BRENT", month: s.lots.find((l) => l.option && l.qty < 0)!.month, side: adj > 0 ? "buy" : "sell", qty: Math.min(Math.abs(adj), 120), kind: "market", tag: "hedge" }];
    }
    void OPTIONS; void leg;
    return [];
  },
};
