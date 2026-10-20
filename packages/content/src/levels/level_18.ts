import { physicalExposureBbl, type LevelSpec, type QuizQuestion, type State } from "@desk/engine";
import { P, hour, isOpen, net, quizAnswers, refFor, usd, hedgeChunk, rollExpiringHedges, TIER4_LIMITS, TIER4_UNLOCKS } from "../bot";
import { askMentorTier4 } from "../mentor";

const DAYS = 75;
const DD_LIMIT = 15e6;
const HORIZON = 30;

const crises = (s: State) => s.events.filter((e) => e.fired && ["expiry_squeeze", "gas_shock", "chokepoint", "hurricane"].includes(e.kind) && !e.id.endsWith(":end") && e.params.status !== "open").map((e) => e.kind);
const survived = (s: State): "pending" | "done" | "failed" => (s.level.status === "running" ? "pending" : s.level.status === "failed" ? "failed" : new Set(crises(s)).size >= 4 ? "done" : "failed");
const noLife = (s: State): "pending" | "done" | "failed" => (s.risk.livesLost > 0 ? "failed" : s.level.status === "running" ? "pending" : "done");
const drawdownInside = (s: State): "pending" | "done" | "failed" => (s.risk.maxDrawdown > DD_LIMIT ? "failed" : s.level.status === "running" ? "pending" : "done");
const noForced = (s: State): "pending" | "done" | "failed" => (s.risk.forcedReductions > 0 ? "failed" : s.level.status === "running" ? "pending" : "done");
const varMostly = (s: State): "pending" | "done" | "failed" => (s.level.status === "running" ? "pending" : s.risk.closesTotal > 0 && s.risk.closesInsideLimit / s.risk.closesTotal >= 0.9 ? "done" : "failed");

/** 3-2-1 units held, read off the product legs: products are only ever the plant's hedge in this level (the inherited WTI outright is not). */
function crackUnits(s: State): number {
  const a = net(s, "RBOB") / 2, b = net(s, "ULSD");
  return Math.sign(a) === Math.sign(b) ? Math.sign(a) * Math.min(Math.abs(a), Math.abs(b)) : 0;
}

/** The next HORIZON days of the plant's runs as the bot expects them, in 3,000-barrel units (zero while shut, half in a turnaround). */
function expectedUnitsAhead(s: State): number {
  const r = s.refinery;
  if (!r) return 0;
  const today = Math.floor(s.tick / 24);
  let bbl = 0;
  for (let d = today + 1; d <= Math.min(today + HORIZON, DAYS - 1); d++) {
    const t = d * 24 + 19;
    const runs = r.shutUntil !== null && r.shutUntil > t ? 0 : r.maintenanceUntil !== null && r.maintenanceUntil > t ? Math.min(r.runs, 0.5) : r.runs;
    bbl += r.capacityKbd * 1000 * runs;
  }
  return bbl / 3000;
}

function quiz(s: State): QuizQuestion[] {
  const exp = s.fills.find((f) => f.tag === "expiry" && f.inst === "WTI");
  return [
    { id: "q1", text: exp ? `Your WTI front month was cash-settled at ${exp.price.toFixed(2)}. The way out was:` : "The inherited long in the WTI front month going into a squeeze was best handled by:", choices: ["Holding to delivery", "Rolling or closing it before the last days, when a landlocked contract with full tanks can settle below zero", "Buying more", "Asking the exchange"], correct: 1, explanation: "A contract with nowhere to deliver is a promise to take oil nobody can take. Roll before the last days; the next month prices on the curve." },
    { id: "q2", text: "Your book inherited 400 short TTF lots with no cargo behind them. When European gas doubled they were:", choices: ["A hedge", "A naked short position: a hedge without the thing it hedges is a position, and it cost the whole move", "Free", "Covered by the LNG"], correct: 1, explanation: "Find the naked hedge on day one. Paper that hedges nothing is risk, whatever the tag says." },
    { id: "q3", text: "When Hormuz closed with your ship inside the Gulf:", choices: ["The cargo was lost", "The ship held until it reopened: hire ran, the window moved with the ship, and the hedge stayed on against the unpriced barrels", "The sale was cancelled", "Nothing changed"], correct: 1, explanation: "A closure is time: hire, a later window, a later invoice. The flat-price risk is unchanged and so is the hedge." },
    { id: "q4", text: "The hurricane shut the plant for five days. The crack hedge for those days was:", choices: ["Still a hedge", "Naked: lift the units for the days the plant will not run", "A long crack", "Irrelevant"], correct: 1, explanation: "A hedge covers production that happens." },
  ];
}

export const level18: LevelSpec = {
  id: 18, tier: 5, title: "Crises", subtitle: "An inherited book through four stylised crises: a squeeze into expiry below zero, a European gas spike, Hormuz closed ten days, a Gulf hurricane",
  days: DAYS, startDate: "2027-04-05", capital: 50e6, creditLine: 400e6, lives: 3,
  instruments: ["WTI", "BRENT", "DUBAI", "TTF", "RBOB", "ULSD"], unlocks: TIER4_UNLOCKS, infoDelayHours: 48, backMonthDepth: 0.5, mentorSilent: true,
  refinery: { slate: "WTI_MIDLAND", runs: 0.9 },
  regime: "normal", world: { oecdInvGap: 10, usInvGap: 35, crudeBalance: 200, geo: 0.3, gasStorageGap: { us: 20, eu: -10 } }, factors: { brentRef: refFor(68, 10, 0.3), ttfRef: 32 },
  limits: { var95: 6e6, netLots: TIER4_LIMITS({ WTI: 4500, BRENT: 1000, DUBAI: 2500, TTF: 1500, RBOB: 2500, ULSD: 1500 }), grossLots: 12000, stopLoss: 15e6, drawdown: DD_LIMIT, concentration: 50 },
  opening: [
    { type: "order", player: "desk", inst: "WTI", month: "2027-05", side: "buy", qty: 300, kind: "market" },
    { type: "order", player: "desk", inst: "TTF", month: "2027-06", side: "sell", qty: 400, kind: "market" },
    { type: "accept_tender", player: "desk", tenderId: "T1" },
    { type: "accept_tender", player: "desk", tenderId: "T2", cargoId: "C1" },
    { type: "fix_charter", player: "desk", cargoId: "C1", vesselId: "V08" },
  ],
  events: [
    { id: "t1", kind: "tender", day: 0, hour: 0, params: { counterparty: "GULF_NATIONAL", side: "offer", grade: "ARAB_LIGHT", bbl: 2000000, incoterm: "FOB", port: "RAS_TANURA", basis: "DUBAI", windowKind: "after_bl", windowDays: 5, laycanStart: 26, laycanDays: 1, openHours: 2, note: "Inherited: a VLCC of Arab Light FOB Ras Tanura, loading day 26-27, Dubai plus the differential, 5 days after B/L." } },
    { id: "t2", kind: "tender", day: 0, hour: 0, params: { counterparty: "EASTERN_PACIFIC", side: "bid", grade: "ARAB_LIGHT", bbl: 2000000, incoterm: "DES", port: "NINGBO", basis: "DUBAI", windowKind: "after_discharge", windowDays: 5, laycanStart: 48, laycanDays: 14, openHours: 2, note: "Inherited: the same cargo sold DES Ningbo to Eastern Pacific, discharge days 48-62, Dubai plus the differential, 5 days after discharge." } },
    { id: "squeeze", kind: "expiry_squeeze", day: 1, hour: 9, params: { inst: "WTI", settleAt: -30 } },
    { id: "inv1", kind: "inventory_release", day: 2, hour: 14 },
    { id: "r1", kind: "rumour", day: 9, hour: 10, params: { headline: "Rumour: Cushing to open emergency storage", moveNow: 0.0, resolveHours: 48, pTrue: 0.5, eventKind: "inventory_shock", eventParams: "{\"usInvGap\":-15,\"headline\":\"Emergency storage opens at Cushing: a little room at the hub\"}" } },
    { id: "inv2", kind: "inventory_release", day: 9, hour: 14 },
    { id: "gas1", kind: "gas_shock", day: 20, hour: 9, params: { ttfPct: 0.45, euGas: -15, euGasTarget: -15, intensity: 1.0, headline: "Pipeline rupture in the North Sea: European gas up by half in a morning", body: "Flows to the continent halve; storage drains; TTF gaps and the regime is stressed: depth halves." } },
    { id: "gas2", kind: "gas_shock", day: 23, hour: 11, params: { ttfPct: 0.25, intensity: 0.6, headline: "Gas: a second leg higher as the repair slips a week" } },
    { id: "hormuz", kind: "chokepoint", day: 28, hour: 9, params: { id: "HORMUZ", status: "closed", headline: "Hormuz closed to all traffic" } },
    { id: "gas3", kind: "gas_shock", day: 32, hour: 9, params: { ttfPct: -0.3, euGasTarget: 10, intensity: 0.2, headline: "Pipeline repaired: flows resume, gas gives back a third" } },
    { id: "inv3", kind: "inventory_release", day: 37, hour: 14 },
    { id: "reopen", kind: "chokepoint", day: 38, hour: 9, params: { id: "HORMUZ", status: "open", headline: "Hormuz reopens; escorts remain" } },
    { id: "r2", kind: "rumour", day: 45, hour: 10, params: { headline: "Rumour: a storm forming in the Gulf of Mexico", moveNow: 0.0, resolveHours: 48, pTrue: 0.5, eventKind: "freight_shock", eventParams: "{\"pct\":0.1,\"headline\":\"Gulf storm forms; tanker rates firm\"}" } },
    { id: "storm", kind: "hurricane", day: 55, hour: 10, params: { days: 5 } },
    { id: "inv4", kind: "inventory_release", day: 58, hour: 14 },
  ],
  briefing: `Seventy-five days, four crises, a book you did not build. You inherit 300 WTI front-month lots long, 400 TTF lots short with nothing behind them, a VLCC of Arab Light bought FOB Ras Tanura and sold DES Ningbo on Dubai, and a 100 kb/d plant with no crack hedge. The mentor says nothing unless asked. The wire is two days behind the world.

The front WTI contract is about to be squeezed into expiry with the tanks full: it will settle below zero. European gas doubles in week three. Hormuz closes for ten days while your ship is inside the Gulf. A hurricane shuts the plant in week eight. Every one of them is survivable with the book inside its limits; none of them is survivable with a naked position left where it was.

Pass: all four crises survived with no life lost, no forced reduction, drawdown under ${usd(DD_LIMIT)}, VaR inside at nine closes in ten.`,
  objectives: [
    { id: "crises", text: "All four crises survived (the level reaches its end)", check: survived, detail: (s) => `${new Set(crises(s)).size} of 4 crises so far` },
    { id: "lives", text: "No life lost", check: noLife },
    { id: "forced", text: "No forced reduction", check: noForced },
    { id: "dd", text: `Drawdown under ${usd(DD_LIMIT)}`, check: drawdownInside, detail: (s) => `drawdown ${usd(s.risk.maxDrawdown)}` },
    { id: "var", text: "VaR inside at 90% of closes", check: varMostly, detail: (s) => `${s.risk.closesInsideLimit} of ${s.risk.closesTotal} closes inside` },
  ],
  cards: [{ id: "squeeze_into_expiry", trigger: () => true }, { id: "liquidity_is_a_regime", trigger: (s) => s.world.regime === "stressed" || s.world.regime === "crisis" }],
  askMentor: askMentorTier4,
  pass: (s) => survived(s) === "done" && noLife(s) === "done" && noForced(s) === "done" && drawdownInside(s) === "done" && varMostly(s) === "done",
  passRuleText: `Four crises survived, no life lost, no forced reduction, drawdown under ${usd(DD_LIMIT)}, VaR inside at 90% of closes, and a correct debrief.`,
  quiz,
  par: 18926818.98, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
  seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  solve: (s) => {
    if (s.level.status === "ended") return quizAnswers(s);
    if (s.level.status !== "running") return [];
    if (!isOpen(s) || hour(s) < 8 || hour(s) > 16) return [];
    // day one: the naked legacy hedge goes, and the front-month long is rolled out of the squeeze
    const ttf = net(s, "TTF");
    if (ttf !== 0 && !s.cargoes.some((c) => c.sale?.basis === "TTF" || c.purchase.basis === "TTF")) return [{ type: "order", player: P, inst: "TTF", month: s.lots.find((l) => l.inst === "TTF")!.month, side: ttf < 0 ? "buy" : "sell", qty: Math.min(Math.abs(ttf), 100), kind: "market", tag: "hedge" }];
    const front = s.listed.WTI[0];
    const wtiFront = net(s, "WTI", front);
    if (wtiFront !== 0 && s.contracts[`WTI:${front}`].expiryTick - s.tick < 20 * 24) return [{ type: "roll", player: P, inst: "WTI", from: front, to: s.listed.WTI[2] }];
    // hedges that would expire before the window prices are rolled
    const roll = rollExpiringHedges(s, 5, 2);
    if (roll) return [roll];
    // the cargo: Dubai against the net unpriced barrels, in the second month
    const dubai = physicalExposureBbl(s).byBasis.DUBAI ?? 0;
    const want = Math.round(-dubai / 1000) - net(s, "DUBAI");
    const o = hedgeChunk("DUBAI", s.lots.find((l) => l.inst === "DUBAI")?.month ?? s.listed.DUBAI[1], want);
    if (o) return [o];
    // the plant: the next thirty days of runs sold in 3-2-1 packages, lifted for the days it will not run
    const target = expectedUnitsAhead(s);
    const held = crackUnits(s);
    const adj = -target - held;
    if (Math.abs(adj) >= 3) {
      const n = Math.min(Math.abs(adj), 40);
      const sellCrack = adj < 0;
      // months that outlive the level: the products' third listed month and WTI's third (the crack's crude leg shares the rolled outright's month)
      const m = { RBOB: s.lots.find((l) => l.inst === "RBOB")?.month ?? s.listed.RBOB[2], ULSD: s.lots.find((l) => l.inst === "ULSD")?.month ?? s.listed.ULSD[2], WTI: s.lots.find((l) => l.inst === "WTI" && l.month !== front)?.month ?? s.listed.WTI[2] };
      return [{ type: "spread", player: P, name: "crack321", legs: [
        { inst: "RBOB", month: m.RBOB, side: sellCrack ? "sell" : "buy", qty: 2 * n },
        { inst: "ULSD", month: m.ULSD, side: sellCrack ? "sell" : "buy", qty: n },
        { inst: "WTI", month: m.WTI, side: sellCrack ? "buy" : "sell", qty: 3 * n },
      ] }];
    }
    return [];
  },
};
