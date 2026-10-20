import { ckey, type LevelSpec, type QuizQuestion, type State } from "@desk/engine";
import { P, buy, flatten, front, hour, leg, levelDay, net, quizAnswers, refFor, second, usd, TIER1_LIMITS_NONE, TIER1_UNLOCKS } from "../bot";
import { askMentorTier1, tier1Mentor } from "../mentor";

const GAP_A = 25; // mb surplus: contango in phase A
const FLIP_DAY = 28; // the curve flips to backwardation here

const rolled = (s: State) => s.fills.filter((f) => f.tag === "roll").length / 2;
const expiredWithLots = (s: State) => s.fills.some((f) => f.tag === "expiry");

function quiz(s: State): QuizQuestion[] {
  const ts = leg(s, "time_spread");
  const flat = leg(s, "flat");
  return [
    { id: "q1", text: `Your time-spread leg this level was ${usd(ts)}. In the first phase (contango) a long position:`, choices: ["Earned the roll as the contract converged up to spot", "Paid the roll: it sold the cheaper expiring month and bought the dearer next one, which then rolled down", "Was unaffected by the curve", "Earned storage income"], correct: 1, explanation: "In contango later months are dearer. Rolling a long sells low and buys high, and the new month then drifts down toward spot. The long pays." },
    { id: "q2", text: "After the stock draw on day 28 the curve flipped. In backwardation a long position:", choices: ["Pays the roll", "Earns the roll: the contract converges up toward the dearer prompt", "Is the same as in contango", "Has no roll because contracts do not expire"], correct: 1, explanation: "Backwardation means the prompt is dearest; a long rolls up the curve and earns it." },
    { id: "q3", text: `Your flat-price leg was ${usd(flat)} and your time-spread leg ${usd(ts)}. Contango is bounded above by:`, choices: ["Nothing: it can be any size", "Full carry: storage cost plus the financing of the price", "The exchange margin", "The spread between Brent and WTI"], correct: 1, explanation: "Beyond full carry anyone can buy, store and sell forward for a sure profit, so the curve cannot stay above it." },
    { id: "q4", text: "High inventories tend to give:", choices: ["Backwardation, because barrels are scarce", "Contango, because the market pays for storage", "A flat curve", "Higher cracks"], correct: 1, explanation: "Term structure follows inventories: surplus is contango, deficit is backwardation." },
  ];
}

export const level02: LevelSpec = {
  id: 2, tier: 1, title: "Term structure", subtitle: "The curve, contango and backwardation, the roll",
  days: 56, startDate: "2027-01-04", capital: 5e6, creditLine: 20e6, lives: 3,
  instruments: ["BRENT"], unlocks: [...TIER1_UNLOCKS, "roll"],
  regime: "calm", world: { oecdInvGap: GAP_A, crudeBalance: 150, targets: { crudeBalance: 150 } }, factors: { brentRef: refFor(75, GAP_A) },
  limits: { var95: 250000, netLots: { ...TIER1_LIMITS_NONE, BRENT: 100 }, grossLots: 200, stopLoss: 800000, drawdown: 1000000, concentration: 50 },
  events: [
    { id: "flip", kind: "inventory_shock", day: FLIP_DAY, hour: 9, params: { oecdInvGap: -45, usInvGap: -10, headline: "Stocks draw hard: a field outage meets a cold snap; the curve flips", body: "A 45 mb swing in the stock picture. The surplus is gone; prompt barrels are now scarce. Watch the front spread." } },
    { id: "flip_balance", kind: "balance_shift", day: FLIP_DAY, hour: 9, params: { kbd: -700, headline: "Balance turns to deficit", body: "The outage takes 700 kb/d out of the balance for the rest of the level.", pause: 0 } },
  ],
  briefing: `Eight weeks, Brent only. Stocks are high and the curve is in contango: later months trade above the front. Hold a long and keep it alive through two expiries (29 January, 26 February): roll it each time, and read what the roll costs in the time-spread leg of your P&L.

Around day 28 the picture changes. The same long then rolls the other way.

Pass: a correct debrief on which structure paid the long and why; roll before each expiry rather than being cash-settled; stay inside the limits.`,
  objectives: [
    { id: "long", text: "Hold a long through both expiries, rolling it twice", check: (s) => (rolled(s) >= 2 ? "done" : s.level.status === "running" ? "pending" : "failed"), detail: (s) => `${rolled(s)} roll${rolled(s) === 1 ? "" : "s"} so far` },
    { id: "no_expiry", text: "Never let a contract expire with lots in it", check: (s) => (expiredWithLots(s) ? "failed" : s.risk.closesTotal > 0 ? "done" : "pending") },
    { id: "var", text: "VaR inside the limit at every close", check: (s) => (s.risk.varBreachedAtClose ? "failed" : s.risk.closesTotal > 0 ? "done" : "pending") },
  ],
  cards: [
    { id: "contango_storage_price", trigger: () => true },
    { id: "full_carry", trigger: (s) => s.tick >= 24 },
    { id: "roll_yield", trigger: (s) => rolled(s) >= 1 },
    { id: "backwardation_pays_long", trigger: (s) => s.factors.spread1.BRENT < -0.1 },
  ],
  mentor: (s, ev) => {
    const lines = tier1Mentor(s, ev);
    if (s.tick === 0 && ev.length === 0) lines.push("Contango. The curve is paying someone to store oil, and if you are long it is you paying. Expiry is the 29th. Roll before it, not after.");
    if (ev.some((e) => e.kind === "event" && e.text.includes("flips"))) lines.push("There it goes. Prompt is scarce now. The same long you had yesterday earns the roll from here. Same lots, different curve.");
    return lines;
  },
  askMentor: askMentorTier1,
  pass: (s) => rolled(s) >= 2 && !expiredWithLots(s) && !s.risk.varBreachedAtClose,
  passRuleText: "Two rolls, nothing expired in the book, VaR inside the limit, and a correct debrief.",
  quiz,
  par: 76540.14, // the bot's P&L on seeds[0], checked in; the live par is computed on the player's seed
  seeds: [1, 2, 3, 5, 6, 7, 8, 9, 10, 11],
  solve: (s) => {
    if (s.level.status === "ended") return quizAnswers(s);
    if (s.level.status !== "running") return [];
    const d = levelDay(s), h = hour(s);
    const f = front(s);
    if (s.tick === 1) return [buy("BRENT", f, 40)];
    // roll two sessions before expiry
    const c = s.contracts[ckey("BRENT", f)];
    if (net(s, "BRENT", f) > 0 && c && s.tick >= c.expiryTick - 48 && h === 12) return [{ type: "roll", player: P, inst: "BRENT", from: f, to: second(s) }];
    if (d === 55 && h === 16) return flatten(s);
    return [];
  },
};
