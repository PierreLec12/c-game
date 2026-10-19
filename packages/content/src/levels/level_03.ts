import type { LevelSpec, QuizQuestion, State } from "@desk/engine";
import { P, flatten, front, grossUnderLimitEveryClose, hour, leg, levelDay, net, quizAnswers, refFor, usd, TIER1_UNLOCKS } from "../bot";
import { askMentorTier1, tier1Mentor } from "../mentor";

const packages = (s: State) => new Set(s.fills.filter((f) => f.packageId && f.tag !== "roll").map((f) => f.packageId)).size;
const spreadPnl = (s: State) => leg(s, "basis") + leg(s, "crack") + leg(s, "time_spread");

function quiz(s: State): QuizQuestion[] {
  return [
    { id: "q1", text: `Your basis leg (Brent-WTI) was ${usd(leg(s, "basis"))} and your crack leg ${usd(leg(s, "crack"))}. When Cushing builds, Brent minus WTI:`, choices: ["Narrows: WTI is scarce", "Widens: WTI must cheapen until it pays to pipe and ship the barrel out", "Does not move: both are crude", "Goes negative"], correct: 1, explanation: "A landlocked build cheapens WTI relative to the seaborne benchmark until exports clear it." },
    { id: "q2", text: "A refinery turnaround strengthens the crack because:", choices: ["Refineries buy more crude", "Less product is made while demand continues, so products gain on crude", "The exchange raises margins", "Gasoline becomes seasonal"], correct: 1, explanation: "A turnaround is a supply event for products: output falls, cracks rise." },
    { id: "q3", text: "The 3-2-1 crack is:", choices: ["Three gasoline, two diesel, one crude", "Two gasoline and one diesel against three crude, a simple refinery's margin", "Three Brent against two WTI and one Dubai", "A time spread"], correct: 1, explanation: "3 bbl of crude into 2 of gasoline and 1 of diesel." },
    { id: "q4", text: `Your flat leg was ${usd(leg(s, "flat"))} against spread legs of ${usd(spreadPnl(s))}. A spread traded as a package:`, choices: ["Has no risk", "Fills both legs together and carries less margin because the legs offset", "Needs twice the margin", "Cannot lose money"], correct: 1, explanation: "Packages fill together; the exchange offsets margin because the legs hedge each other. The spread can still move against you." },
  ];
}

export const level03: LevelSpec = {
  id: 3, tier: 1, title: "Spreads", subtitle: "Time and inter-commodity spreads as packages, the 3-2-1 crack",
  days: 20, startDate: "2027-01-04", capital: 5e6, creditLine: 20e6, lives: 3,
  instruments: ["BRENT", "WTI", "RBOB", "ULSD"], unlocks: [...TIER1_UNLOCKS, "spread", "roll"],
  regime: "calm", world: { oecdInvGap: 0, usInvGap: 0, refineryRuns: 0.9 }, factors: { brentRef: refFor(75, 0) },
  limits: { var95: 300000, netLots: { BRENT: 100, WTI: 100, RBOB: 40, ULSD: 40, HH: 0, TTF: 0 }, grossLots: 300, stopLoss: 600000, drawdown: 800000, concentration: 1 },
  events: [
    { id: "cushing", kind: "inventory_shock", day: 4, hour: 15, params: { usInvGap: 12, headline: "Cushing builds 12 mb as a new pipeline fills the hub", body: "Landlocked crude piles up at Cushing. WTI has to cheapen against Brent until it pays to move the barrel to the coast and ship it." } },
    { id: "turnaround", kind: "refinery_turnaround", day: 9, hour: 9, params: { runs: -0.1, days: 10, headline: "Gulf Coast turnaround season starts early: runs cut 10%", body: "Several plants go down for maintenance. Less gasoline and diesel is made; cracks strengthen while they are out." } },
  ],
  briefing: `Twenty days: Brent, WTI, RBOB and ULSD. The flat price should go nowhere; the relationships will move. Expect a Cushing build within the week (Brent-WTI widens) and turnaround season to start early (the crack strengthens).

Trade spreads as packages from the ticket's spread tab: a Brent-WTI package, a 3-2-1 crack. Note the margin the exchange asks for a package against two outrights.

Pass: at least two spread packages with spread P&L in the attribution, gross exposure under the limit at every close.`,
  objectives: [
    { id: "two_spreads", text: "Trade at least two spread packages", check: (s) => (packages(s) >= 2 ? "done" : "pending"), detail: (s) => `${packages(s)} package${packages(s) === 1 ? "" : "s"}` },
    { id: "spread_pnl", text: "Spread P&L shows in the attribution (basis or crack leg)", check: (s) => (Math.abs(leg(s, "basis")) + Math.abs(leg(s, "crack")) > 0 ? "done" : "pending") },
    { id: "gross", text: "Gross exposure under the limit at every close", check: grossUnderLimitEveryClose },
  ],
  cards: [
    { id: "spread_is_a_view", trigger: () => true },
    { id: "brent_wti_pipeline_ship", trigger: (s) => s.fills.some((f) => f.tag === "inter_commodity") || s.news.some((n) => n.headline.startsWith("Cushing")) },
    { id: "crack_refinery_margin", trigger: (s) => s.fills.some((f) => f.tag === "crack") || s.news.some((n) => n.headline.includes("turnaround")) },
  ],
  mentor: (s, ev) => {
    const lines = tier1Mentor(s, ev);
    if (s.tick === 0 && ev.length === 0) lines.push("Nothing here is about where oil goes. Everything is about where two things go relative to each other. Use the spread tab.");
    if (ev.some((e) => e.text.startsWith("Cushing"))) lines.push("Cushing is full. WTI has to pay its way to the water now. Who is long WTI against Brent?");
    if (ev.some((e) => e.text.includes("turnaround"))) lines.push("Runs down. Less product, same demand. The crack is a refinery's margin and the refinery just left.");
    return lines;
  },
  askMentor: askMentorTier1,
  pass: (s) => packages(s) >= 2 && Math.abs(leg(s, "basis")) + Math.abs(leg(s, "crack")) > 0 && !s.risk.breaches.some((b) => b.limit === "grossLots"),
  passRuleText: "Two packages, spread P&L in the attribution, gross under the limit at every close.",
  quiz,
  par: 61849.6, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
  seeds: [2, 3, 4, 5, 6, 7, 8, 9, 11, 12],
  solve: (s) => {
    if (s.level.status === "ended") return quizAnswers(s);
    if (s.level.status !== "running") return [];
    const d = levelDay(s), h = hour(s);
    // long Brent-WTI into the Cushing build, closed a week after
    if (d === 1 && h === 10) return [{ type: "spread", player: P, name: "inter", legs: [{ inst: "BRENT", month: front(s), side: "buy", qty: 30 }, { inst: "WTI", month: front(s, "WTI"), side: "sell", qty: 30 }] }];
    if (d === 11 && h === 10 && net(s, "WTI") < 0 && net(s, "BRENT") > 0) return [{ type: "spread", player: P, name: "inter", legs: [{ inst: "BRENT", month: front(s), side: "sell", qty: 30 }, { inst: "WTI", month: front(s, "WTI"), side: "buy", qty: 30 }] }];
    // long the 3-2-1 crack into the turnaround, closed near the end
    if (d === 8 && h === 10) return [{ type: "spread", player: P, name: "crack321", legs: [{ inst: "RBOB", month: front(s, "RBOB"), side: "buy", qty: 20 }, { inst: "ULSD", month: front(s, "ULSD"), side: "buy", qty: 10 }, { inst: "WTI", month: front(s, "WTI"), side: "sell", qty: 30 }] }];
    if (d === 18 && h === 10) return flatten(s);
    if (d === 19 && h === 16) return flatten(s);
    return [];
  },
};
