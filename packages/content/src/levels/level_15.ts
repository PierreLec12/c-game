import { LNG, PORTS, VESSEL_CLASSES, basisPrice, charterQuotes, fairDiff, hireNow, physicalExposureBbl, shortestPath, blockedNodes, daysFor, type LevelSpec, type QuizQuestion, type State, type Tender } from "@desk/engine";
import { P, accept, cargo0, drillAnswers, hour, isOpen, leg, quizAnswers, refFor, usd, varInsideEveryClose, gasHedgeAdjustment, gasHedgeChunk, gasHedgeMonth, gasHedgeRecord, TIER4_LIMITS, TIER4_UNLOCKS } from "../bot";
import { drillSet } from "../drills";
import { askMentorTier4, tier4Mentor } from "../mentor";

const delivered = (s: State): "pending" | "done" | "failed" => (s.cargoes.some((c) => c.grade === "LNG" && c.status === "delivered" && c.sale) ? "done" : s.level.status === "running" ? "pending" : "failed");
const hedgeOn = (basis: "HH" | "TTF" | "JKM") => (s: State): "pending" | "done" | "failed" => { const r = gasHedgeRecord(s, basis); if (s.level.status === "running") return r.total > 4 && r.inside / r.total < 0.5 ? "failed" : "pending"; return r.total > 0 && r.inside / r.total >= 0.75 ? "done" : "failed"; };
const saleBasis = (s: State): "TTF" | "JKM" => (s.cargoes[0]?.sale?.basis === "JKM" ? "JKM" : s.cargoes[0]?.sale?.basis === "TTF" ? "TTF" : (s.cargoes[0]?.dischargePort === "SODEGAURA" ? "JKM" : "TTF"));
const saleHedge = (s: State) => hedgeOn(saleBasis(s))(s);
const profit = (s: State): "pending" | "done" | "failed" => (s.level.status === "running" ? (s.pnl.total > 0 ? "done" : "pending") : s.pnl.total > 0 ? "done" : "failed");

/** Netback of a delivered bid to the loading port: the hub price at the discharge window plus the differential, less shipping per MMBtu. */
export function netbackOf(s: State, t: Tender): { netback: number; delivered: number; shipping: number; days: number } {
  const path = shortestPath(PORTS.SABINE_PASS.node, PORTS[t.port].node, blockedNodes(s));
  const days = path ? daysFor(path.nm, VESSEL_CLASSES.LNGC.speedLaden) : 20;
  const delivered = basisPrice(s, t.basis, t.laycan[0]) + t.diff;
  // hire for the voyage over the cargo, plus the boil-off lost on the way at the delivered price
  const shipping = (hireNow(s, "LNGC") * 1.08 * (days + 4)) / LNG.cargoMmbtu.value + LNG.boilOffPerDay.value * days * delivered;
  return { netback: delivered - shipping, delivered, shipping, days };
}

/** Where the desk means to sell an unsold cargo: the terminal with the better netback at today's fair delivered differentials. */
export function plannedBasis(s: State): "TTF" | "JKM" {
  const gate = netbackOf(s, { port: "GATE", basis: "TTF", diff: fairDiff(s, "LNG", "DES", "GATE", "TTF"), laycan: [24, 30] } as Tender).netback;
  const sode = netbackOf(s, { port: "SODEGAURA", basis: "JKM", diff: fairDiff(s, "LNG", "DES", "SODEGAURA", "JKM"), laycan: [36, 42] } as Tender).netback;
  return sode > gate ? "JKM" : "TTF";
}

function quiz(s: State): QuizQuestion[] {
  const fx = leg(s, "fx");
  const c = s.cargoes[0];
  return [
    { id: "q1", text: `Your FX leg was ${usd(fx)}. It came from:`, choices: ["Nothing: everything was in dollars", "The euro-priced parts of the book (TTF futures margin, a TTF-priced invoice, EUR cash) revalued as EURUSD moved", "The JKM premium", "Boil-off"], correct: 1, explanation: "TTF is in euros per megawatt-hour. Anything priced on it, paper or physical, carries the dollar value of a euro amount." },
    { id: "q2", text: "A 3,600,000 MMBtu cargo priced on TTF is hedged with about:", choices: ["360 TTF lots", "3,600 TTF lots", "1,465 TTF lots: 3,600,000 / 3.412 MWh per MMBtu / 720 MWh a lot", "36 TTF lots"], correct: 2, explanation: "MMBtu to MWh is a division by 3.412; the lot is 720 MWh. Get it wrong and the hedge is 3.4 times out." },
    { id: "q3", text: c ? `You delivered to ${PORTS[c.dischargePort].name}. The destination was chosen by:` : "The destination of an LNG cargo is chosen by:", choices: ["The highest headline price", "The highest netback: hub price less regas, shipping and the buyer's margin, back to the loading port", "The shortest voyage", "The buyer's rating"], correct: 1, explanation: "A longer voyage costs days of hire; the Asian premium pays for it only when it is bigger than the extra days." },
    { id: "q4", text: "Injection season means:", choices: ["Prices always rise", "Storage fills through the summer and the weekly storage number is the release the market trades against consensus", "No trading", "Gas cannot be stored"], correct: 1, explanation: "The curve is the price of carrying a molecule from summer to winter; the weekly figure moves the prompt by its surprise." },
  ];
}

export const level15: LevelSpec = {
  id: 15, tier: 4, title: "Gas and LNG", subtitle: "HH, TTF, JKM; an LNG cargo FOB Sabine Pass delivered where the netback says; the EUR leg",
  days: 50, startDate: "2027-04-05", capital: 50e6, creditLine: 400e6, lives: 3,
  instruments: ["HH", "TTF", "JKM"], unlocks: TIER4_UNLOCKS, infoDelayHours: 24, backMonthDepth: 0.5,
  regime: "normal", world: { oecdInvGap: 0, gasStorageGap: { us: 50, eu: 5 } }, factors: { brentRef: refFor(74, 0), hhRef: 4.5, ttfRef: 26 },
  limits: { var95: 4e6, netLots: TIER4_LIMITS({ HH: 1000, TTF: 2500, JKM: 1000 }), grossLots: 6000, stopLoss: 8e6, drawdown: 10e6, concentration: 50 },
  events: [
    { id: "fob", kind: "tender", day: 0, hour: 9, params: { counterparty: "GULF_LNG", side: "offer", grade: "LNG", incoterm: "FOB", port: "SABINE_PASS", basis: "HH", windowKind: "after_bl", windowDays: 5, laycanStart: 6, laycanDays: 1, openHours: 48, note: "Gulf Coast LNG offers a full cargo, 3,600,000 MMBtu FOB Sabine Pass, loading day 6-7, Henry Hub plus the tolling fee, pricing 5 days after B/L. Two LNG carriers are at the jetty." } },
    { id: "gate", kind: "tender", day: 2, hour: 9, params: { counterparty: "NORTHGAS", side: "bid", grade: "LNG", incoterm: "DES", port: "GATE", basis: "TTF", windowKind: "after_discharge", windowDays: 5, laycanStart: 20, laycanDays: 8, openHours: 72, note: "Northgas bids for a DES Gate cargo, discharge days 20-28, TTF (in dollars per MMBtu at the day's rate) less regas and margin, 5 days after discharge, paid in euros." } },
    { id: "sode", kind: "tender", day: 2, hour: 10, params: { counterparty: "SAKURA_POWER", side: "bid", grade: "LNG", incoterm: "DES", port: "SODEGAURA", basis: "JKM", windowKind: "after_discharge", windowDays: 5, laycanStart: 32, laycanDays: 8, openHours: 72, note: "Sakura Power bids for a DES Sodegaura cargo, discharge days 32-40, JKM less regas and margin, 5 days after discharge." } },
    { id: "g1", kind: "gas_storage_release", day: 3, hour: 14 },
    { id: "hire", kind: "freight_shock", day: 4, hour: 9, params: { pct: 0.25, headline: "LNG carrier rates jump a quarter on Atlantic demand", body: "Anyone who has not fixed yet pays more." } },
    { id: "g2", kind: "gas_storage_release", day: 10, hour: 14 },
    { id: "cold", kind: "cold_snap", day: 15, hour: 9, params: { hdd: 5, days: 6, pct: 0.07, headline: "A late cold snap over north-west Europe" } },
    { id: "g3", kind: "gas_storage_release", day: 17, hour: 14 },
    { id: "g4", kind: "gas_storage_release", day: 24, hour: 14 },
    { id: "rumour", kind: "rumour", day: 26, hour: 10, params: { headline: "Rumour: Freeport LNG trips offline", moveNow: 0.0, resolveHours: 36, pTrue: 0.5, eventKind: "gas_shock", eventParams: "{\"hhPct\":-0.05,\"headline\":\"Freeport confirms an outage: feedgas demand falls, Henry Hub softens\"}" } },
    { id: "g5", kind: "gas_storage_release", day: 31, hour: 14 },
    { id: "norway", kind: "gas_shock", day: 35, hour: 9, params: { ttfPct: -0.06, euGas: 8, euGasTarget: 8, headline: "Norwegian maintenance ends early: flows to Europe surge", body: "TTF gives up six percent; JKM follows, less the premium." } },
    { id: "g6", kind: "gas_storage_release", day: 38, hour: 14 },
    { id: "g7", kind: "gas_storage_release", day: 45, hour: 14 },
  ],
  briefing: `Fifty days of gas, in injection season. Gulf Coast LNG offers a full cargo FOB Sabine Pass at Henry Hub plus the tolling fee; two carriers sit at the jetty. On day 2 two buyers bid: Northgas DES Gate on TTF, Sakura Power DES Sodegaura on JKM. Work both netbacks to the plant before you choose: hub price, less regas, less the buyer's margin, less hire times days over the cargo's MMBtu. Book a regas slot or the ship waits three days for one.

Hedge each leg in the contract it prices on, in that contract's units: 3,600,000 MMBtu is 360 Henry Hub lots and about 1,465 TTF lots. The engine will take any number; only one is right. A TTF sale is paid in euros: the book will show an FX leg, and the quiz will ask where it came from.

Pass: the cargo delivered and sold, the purchase hedged on Henry Hub and the sale hedged on its hub at three closes in four, profitable, VaR inside the limit.`,
  objectives: [
    { id: "delivered", text: "An LNG cargo delivered and sold", check: delivered },
    { id: "hh", text: "Purchase hedged on Henry Hub (within 25% of one-to-one) at 75% of closes with exposure", check: hedgeOn("HH"), detail: (s) => { const r = gasHedgeRecord(s, "HH"); return `${r.inside} of ${r.total} closes`; } },
    { id: "sale", text: "Sale hedged on its hub (TTF or JKM, in its own units) at 75% of closes with exposure", check: saleHedge, detail: (s) => { const r = gasHedgeRecord(s, saleBasis(s)); return `${saleBasis(s)}: ${r.inside} of ${r.total} closes`; } },
    { id: "profit", text: "Profitable", check: profit, detail: (s) => `P&L ${usd(s.pnl.total)}` },
    { id: "var", text: "VaR inside the limit at every close", check: varInsideEveryClose },
  ],
  cards: [
    { id: "mmbtu_mwh_m3", trigger: () => true },
    { id: "netback", trigger: (s) => s.tenders.some((t) => t.side === "bid") },
    { id: "storage_is_the_gas_curve", trigger: (s) => s.releases.some((r) => r.published) },
  ],
  mentor: (s, ev) => {
    const lines = tier4Mentor(s, ev);
    if (s.tick === 0 && ev.length === 0) lines.push("Gas has three units and two currencies. Before you touch a ticket, do the conversions on the card; the drills on the Academy will tell you if you can.");
    if (ev.some((e) => e.kind === "tender" && e.text.includes("Bid"))) lines.push("Two buyers, two hubs, two voyages. Netback each one to the jetty. The headline price is not the answer.");
    if (ev.some((e) => e.kind === "event" && e.text.includes("Cold snap"))) lines.push("Europe just got dearer. If you sold to Asia, the hedge on JKM carries the Asian premium narrowing; read the basis row.");
    return lines;
  },
  askMentor: askMentorTier4,
  pass: (s) => delivered(s) === "done" && hedgeOn("HH")(s) === "done" && saleHedge(s) === "done" && s.pnl.total > 0 && varInsideEveryClose(s) === "done",
  passRuleText: "Cargo delivered and sold, both legs hedged in the right contract and units at 75% of closes, profitable, VaR inside at every close, and a correct debrief.",
  quiz,
  drills: (seed) => drillSet(seed, ["mmbtu_mwh", "ttf_pnl", "hedge_lots"], "level15"),
  par: 4310935.73, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
  seeds: [1, 2, 3, 4, 5, 6, 7, 9, 11, 12],
  solve: (s) => {
    if (s.level.status === "ended") return quizAnswers(s);
    if (s.level.status !== "running") return [];
    if (s.tick === 1) { const d = drillAnswers(s); if (d.length) return d; }
    const c = cargo0(s);
    const offer = s.tenders.find((t) => t.status === "open" && t.side === "offer");
    if (!c && offer) return [accept(offer.id)];
    if (c && !c.vesselId && c.status === "contracted") { const q = charterQuotes(s, c).find((x) => x.fits && x.etaLoadDay <= c.laycan[1]); if (q) return [{ type: "fix_charter", player: P, cargoId: c.id, vesselId: q.vesselId }]; }
    const bids = s.tenders.filter((t) => t.status === "open" && t.side === "bid");
    if (c && !c.sale && bids.length >= 2) {
      const best = bids.map((t) => ({ t, n: netbackOf(s, t).netback })).sort((a, b) => b.n - a.n)[0];
      return [accept(best.t.id, c.id)];
    }
    if (c && c.sale && !c.regasBooked && c.status !== "delivered") return [{ type: "book_regas", player: P, cargoId: c.id }];
    if (isOpen(s) && hour(s) >= 8 && hour(s) <= 16) {
      // every leg in the contract it prices on, in that contract's units, in the month already held. An unsold cargo is marked
      // at Gate (TTF); the desk hedges it on the hub it means to sell into, which is the better netback of the two terminals.
      const plan = c && !c.sale ? plannedBasis(s) : null;
      const ex = physicalExposureBbl(s).byBasis;
      for (const basis of ["HH", "TTF", "JKM"] as const) {
        let units = ex[basis] ?? 0;
        if (plan && basis === "TTF" && plan !== "TTF") units = 0;
        if (plan && basis === plan && plan !== "TTF") units += ex.TTF ?? 0;
        const o = gasHedgeChunk(basis, gasHedgeMonth(s, basis, basis === "HH" ? 1 : 2), gasHedgeAdjustment(s, basis, units));
        if (o) return [o];
      }
    }
    return [];
  },
};
