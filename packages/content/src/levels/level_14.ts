import { GRADES, SLATES, crackUnitsHeld, refineryMarginPerBbl, type LevelSpec, type QuizQuestion, type State } from "@desk/engine";
import { P, hour, isOpen, leg, levelDay, quizAnswers, refFor, usd, varInsideEveryClose, TIER4_LIMITS, TIER4_UNLOCKS } from "../bot";
import { askMentorTier4, tier4Mentor } from "../mentor";

const DAYS = 45;
const HORIZON = 30; // days of runs the plant hedges forward
const UNIT_BBL = 3000; // a 3-2-1 package is 3 WTI lots of crude
const BAND = 0.25;
const PAR_BAND = 0.05;

/** Crack units the plant should be short at a close: the next HORIZON days of runs as they were actually made (the band absorbs what could not be known). */
function targetUnitsAt(s: State, day: number): number {
  const r = s.refinery;
  if (!r) return 0;
  let bbl = 0;
  for (const h of r.history) if (h.day > day && h.day <= Math.min(day + HORIZON, DAYS - 1)) bbl += h.crudeBbl;
  return bbl / UNIT_BBL;
}
/** The bot's forward view of the same number: runs as set, zero while shut, half in a turnaround. */
function expectedUnitsAhead(s: State): number {
  const r = s.refinery;
  if (!r) return 0;
  const today = levelDay(s);
  let bbl = 0;
  for (let d = today + 1; d <= Math.min(today + HORIZON, DAYS - 1); d++) {
    const t = d * 24 + 19;
    const runs = r.shutUntil !== null && r.shutUntil > t ? 0 : r.maintenanceUntil !== null && r.maintenanceUntil > t ? Math.min(r.runs, 0.5) : r.runs;
    bbl += r.capacityKbd * 1000 * runs;
  }
  return bbl / UNIT_BBL;
}
const unitsFromNet = (net: Record<string, number>): number => {
  const a = net.RBOB / 2, b = net.ULSD, c = -net.WTI / 3;
  const same = Math.sign(a) === Math.sign(b) && Math.sign(b) === Math.sign(c);
  return same ? Math.sign(a) * Math.min(Math.abs(a), Math.abs(b), Math.abs(c)) : 0;
};
export function crackHedgeRecord(s: State): { inside: number; total: number } {
  let inside = 0, total = 0;
  for (const c of s.risk.closes) {
    const day = Math.floor(c.tick / 24);
    if (day < 3) continue;
    const target = targetUnitsAt(s, day);
    if (target < 30) continue;
    total += 1;
    const held = unitsFromNet(c.net);
    if (Math.abs(held + target) <= Math.max(25, BAND * target)) inside += 1;
  }
  return { inside, total };
}
const hedgeInBand = (s: State): "pending" | "done" | "failed" => { const r = crackHedgeRecord(s); if (s.level.status === "running") return r.total > 5 && r.inside / r.total < 0.6 ? "failed" : "pending"; return r.total > 0 && r.inside / r.total >= 0.8 ? "done" : "failed"; };
export function slateRecord(s: State): { right: number; total: number } {
  const h = s.refinery?.history ?? [];
  return { right: h.filter((x) => x.marginPerBbl >= x.bestMarginPerBbl - 0.3).length, total: h.length };
}
const slateRight = (s: State): "pending" | "done" | "failed" => { const r = slateRecord(s); if (s.level.status === "running") return "pending"; return r.total > 0 && r.right / r.total >= 0.7 ? "done" : "failed"; };
const insidePar = (s: State): "pending" | "done" | "failed" => { if (s.level.status === "running") return "pending"; const par = s.level.par; if (par === 0) return s.pnl.total > 0 ? "done" : "failed"; return s.pnl.total >= par - PAR_BAND * Math.abs(par) ? "done" : "failed"; };

function quiz(s: State): QuizQuestion[] {
  const h = s.refinery?.history ?? [];
  const shut = h.filter((x) => x.runs === 0).length;
  return [
    { id: "q1", text: `Your plant realised ${usd(s.refinery?.marginUsd ?? 0)} over the level and the crack leg of the hedge was ${usd(leg(s, "crack"))}. When the gasoline crack rose into the season:`, choices: ["The plant lost", "The hedge lost and the plant earned it back barrel by barrel: the margin was locked, not improved", "Both gained", "Nothing happened to either"], correct: 1, explanation: "Selling the crack forward fixes the margin. A rising crack is a loss on paper and a gain on the barrels; the sum is the locked margin." },
    { id: "q2", text: `The plant was shut for ${shut} day${shut === 1 ? "" : "s"} by the hurricane. A crack hedge left on for those days was:`, choices: ["Still a hedge", "A naked short crack: the barrels it hedged were never made, while cracks jumped", "A long crack", "Irrelevant"], correct: 1, explanation: "A hedge is only a hedge against production that happens. Lift the units for the days the plant will not run." },
    { id: "q3", text: "The slate decision each day is:", choices: ["Always the sweetest crude", "The crude with the higher margin per barrel at today's differentials, yields and cracks", "Whatever the risk manager says", "Fixed for the level"], correct: 1, explanation: "A sour grade at a deep discount beats a sweet grade at a premium until the discount fades; the yield table and the differentials decide, every day." },
    { id: "q4", text: "The 3-2-1 package's flat-price legs cancelled in the waterfall because:", choices: ["Products have no flat price", "2 RBOB + 1 ULSD against 3 WTI is 3,000 bbl against 3,000 bbl: only the crack and the structure remain", "The exchange nets them", "They were small"], correct: 1, explanation: "Two gasoline lots and one diesel lot are 126,000 gallons, three crude lots are 3,000 barrels: the same oil. What is left is the crack." },
  ];
}

export const level14: LevelSpec = {
  id: 14, tier: 4, title: "The refinery", subtitle: "Run the plant, choose the slate, hedge the crack into driving season and a hurricane",
  days: DAYS, startDate: "2027-05-03", capital: 50e6, creditLine: 400e6, lives: 3,
  instruments: ["WTI", "RBOB", "ULSD", "BRENT"], unlocks: TIER4_UNLOCKS, infoDelayHours: 24, backMonthDepth: 0.5,
  refinery: { slate: "WTI_MIDLAND", runs: 0.9 },
  regime: "normal", world: { oecdInvGap: 0, crudeBalance: 0, refineryRuns: 0.9, productInvGap: { gasoline: -1, distillate: 0, fuelOil: 1 } }, factors: { brentRef: refFor(72, 0) },
  limits: { var95: 5e6, netLots: TIER4_LIMITS({ WTI: 4000, RBOB: 2500, ULSD: 1500, BRENT: 500 }), grossLots: 9000, stopLoss: 12e6, drawdown: 15e6, concentration: 50 },
  events: [
    { id: "osp1", kind: "grade_diff_shock", day: 0, hour: 8, params: { grade: "ARAB_LIGHT", delta: -7, headline: "Gulf producer slashes its official selling price: Arab Light at a deep discount for June loaders", body: "A fight for Asian market share. For a plant that can run sour, the cheaper barrel is on the Gulf side this month; the discount will not last." } },
    { id: "inv1", kind: "inventory_release", day: 2, hour: 14 },
    { id: "turn", kind: "plant_maintenance", day: 7, hour: 9, params: { days: 5 } },
    { id: "inv2", kind: "inventory_release", day: 9, hour: 14 },
    { id: "world", kind: "refinery_turnaround", day: 12, hour: 9, params: { runs: -0.06, days: 8, headline: "Gulf Coast maintenance season: a tenth of the coast's capacity down for a week", body: "Other plants down means less product made: the cracks firm. Your plant is running." } },
    { id: "inv3", kind: "inventory_release", day: 16, hour: 14 },
    { id: "osp2", kind: "grade_diff_shock", day: 20, hour: 8, params: { grade: "ARAB_LIGHT", delta: -5, headline: "A second OSP cut: Arab Light cheaper again", body: "The discount is back. Check the slate." } },
    { id: "storm", kind: "hurricane", day: 24, hour: 10, params: { days: 5, headline: "Early-season hurricane makes landfall on the Gulf Coast: refineries shut, ports closed for five days" } },
    { id: "inv4", kind: "inventory_release", day: 30, hour: 14 },
    { id: "rumour", kind: "rumour", day: 33, hour: 10, params: { headline: "Rumour: the Gulf producer is raising its OSP back up for July", moveNow: 0.0, resolveHours: 48, pTrue: 0.5, eventKind: "grade_diff_shock", eventParams: "{\"grade\":\"ARAB_LIGHT\",\"delta\":4,\"headline\":\"OSP raised: the Arab Light discount closes\"}" } },
    { id: "inv5", kind: "inventory_release", day: 37, hour: 14 },
  ],
  briefing: `Forty-five days running a 100 kb/d plant into driving season. The plant is long the crack: sell it forward in 3-2-1 packages for the next thirty days of runs, and roll the hedge down as each day's barrels are made. The slate is a daily choice between WTI Midland and Arab Light at whatever the differentials say; a deep OSP cut on day 0 makes the sour barrel the cheaper one for a while.

A five-day turnaround halves the plant in week two; a hurricane shuts it in week four. A hedge on barrels that will not be made is a naked short crack. Lift it.

Pass: margin realised within ${Math.round(PAR_BAND * 100)}% of par, the crack hedge inside ${Math.round(BAND * 100)}% of the next ${HORIZON} days of runs at four closes in five, the better slate run seven days in ten, VaR inside the limit at every close.`,
  objectives: [
    { id: "par", text: `Margin realised within ${Math.round(PAR_BAND * 100)}% of par`, check: insidePar, detail: (s) => `P&L ${usd(s.pnl.total)}, plant ${usd(s.refinery?.marginUsd ?? 0)}` },
    { id: "hedge", text: `Crack hedge in band (within ${Math.round(BAND * 100)}% of the next ${HORIZON} days of runs) at 80% of closes`, check: hedgeInBand, detail: (s) => { const r = crackHedgeRecord(s); return `${r.inside} of ${r.total} closes in band`; } },
    { id: "slate", text: "The better slate run on 70% of days", check: slateRight, detail: (s) => { const r = slateRecord(s); return `${r.right} of ${r.total} days on the better slate`; } },
    { id: "var", text: "VaR inside the limit at every close", check: varInsideEveryClose },
  ],
  cards: [
    { id: "yields", trigger: () => true },
    { id: "seasonality_of_cracks", trigger: (s) => s.fills.length > 0 },
    { id: "turnaround_is_supply", trigger: (s) => s.refinery !== null && (s.refinery.maintenanceUntil !== null || s.refinery.shutUntil !== null) },
  ],
  mentor: (s, ev) => {
    const lines = tier4Mentor(s, ev);
    if (s.tick === 0 && ev.length === 0) lines.push("A plant is a long crack position that cannot be closed, only hedged. Sell the next month of runs in packages, choose the crude by margin, and read the yields card first.");
    if (ev.some((e) => e.kind === "refinery" && e.text.includes("turnaround"))) lines.push("Half the runs for five days. Half the hedge for those days, or you are short crack on barrels that will not exist.");
    if (ev.some((e) => e.kind === "refinery" && e.text.includes("Hurricane"))) lines.push("Shut. Cracks jumped and you make nothing. Every unit hedging the shut days is naked: buy them back now.");
    if (ev.some((e) => e.text.includes("OSP")) && !ev.some((e) => e.kind === "rumour")) lines.push("The sour barrel just got cheaper. Compare the two margins on the Desk before the day's run.");
    return lines;
  },
  askMentor: askMentorTier4,
  pass: (s) => insidePar(s) === "done" && hedgeInBand(s) === "done" && slateRight(s) === "done" && varInsideEveryClose(s) === "done",
  passRuleText: `Margin within ${Math.round(PAR_BAND * 100)}% of par, the crack hedge in band at 80% of closes, the better slate 70% of days, VaR inside at every close, and a correct debrief.`,
  quiz,
  par: 14605403.24, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
  seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  solve: (s) => {
    if (s.level.status === "ended") return quizAnswers(s);
    if (s.level.status !== "running" || !s.refinery) return [];
    const r = s.refinery;
    const h = hour(s);
    // the slate: the better margin, decided once a day before the run
    if (h === 9 && !r.pendingSlate) {
      const best = SLATES.map((g) => ({ g, m: refineryMarginPerBbl(s, g).perBbl })).sort((a, b) => b.m - a.m)[0];
      if (best.g !== r.slate && best.m > refineryMarginPerBbl(s, r.slate).perBbl + 0.3) return [{ type: "set_slate", player: P, grade: best.g }];
    }
    // the hedge: short the next thirty days of runs in 3-2-1 units, in the liquid hours
    if (isOpen(s) && h >= 8 && h <= 16) {
      const target = expectedUnitsAhead(s);
      const held = crackUnitsHeld(s).units;
      const adj = -target - held; // units to add (negative: sell more crack)
      if (Math.abs(adj) >= 3) {
        const n = Math.min(Math.abs(adj), 40);
        const sellCrack = adj < 0;
        const m = { RBOB: s.listed.RBOB[1], ULSD: s.listed.ULSD[1], WTI: s.listed.WTI[1] };
        return [{ type: "spread", player: P, name: "crack321", legs: [
          { inst: "RBOB", month: m.RBOB, side: sellCrack ? "sell" : "buy", qty: 2 * n },
          { inst: "ULSD", month: m.ULSD, side: sellCrack ? "sell" : "buy", qty: n },
          { inst: "WTI", month: m.WTI, side: sellCrack ? "buy" : "sell", qty: 3 * n },
        ] }];
      }
    }
    void GRADES;
    return [];
  },
};
