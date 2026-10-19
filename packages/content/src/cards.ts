/**
 * Concept cards: a titled panel with one diagram where it helps, three sentences, a worked number from the
 * player's own book, and a "show me" target. Tier 0 and tier 1 cards ship in milestone 1.
 */
import { INSTRUMENTS, ckey, type State, fullCarry } from "@desk/engine";

export type Diagram = "none" | "bidask" | "curve_contango" | "curve_backwardation" | "margin" | "timeline" | "spread" | "crack" | "release";

export interface Card {
  id: string;
  title: string;
  level: number; // first level it appears in
  diagram: Diagram;
  sentences: [string, string, string];
  /** A worked number from the player's own book, or a reason there is none yet. */
  worked: (state: State) => string;
  showMe: { screen: string; target: string; label: string };
  terms: { term: string; definition: string }[];
}

const usd = (x: number) => (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString();
const frontQuote = (s: State) => s.quotes[ckey("BRENT", s.listed.BRENT[0])];

export const CARDS: Card[] = [
  {
    id: "what_a_lot_is", title: "What a lot is", level: 0, diagram: "none",
    sentences: ["A futures lot is a fixed quantity of the commodity: 1,000 barrels for Brent and WTI, 42,000 gallons for RBOB and ULSD, 10,000 MMBtu for Henry Hub.", "Your P&L on one lot is the price move times the lot size, so a one-cent move on a Brent lot is ten dollars.", "Size is the number of lots; direction is long or short; the two together are your exposure."],
    worked: (s) => { const q = frontQuote(s); return q ? `One Brent lot at ${q.mid.toFixed(2)} is ${usd(q.mid * 1000)} of notional; a $1 move is $1,000 per lot.` : "Not yet: no Brent quote."; },
    showMe: { screen: "markets", target: "ticket-qty", label: "the lots field on the ticket" },
    terms: [{ term: "lot", definition: "The fixed quantity of one futures contract." }, { term: "notional", definition: "Price times lot size times lots: what the position is worth at face." }],
  },
  {
    id: "ask_above_bid", title: "Why the ask is above the bid", level: 0, diagram: "bidask",
    sentences: ["The bid is what someone will pay you now; the ask is what someone will sell to you now; the gap is the market maker's fee for being there.", "A market order crosses the spread and pays it at once; a limit order waits on your side of it and may never fill.", "Depth is how many lots sit at the touch: an order bigger than the depth walks the book and pays slippage on top."],
    worked: (s) => { const q = frontQuote(s); return q ? `Brent ${s.listed.BRENT[0]} now: bid ${q.bid.toFixed(2)}, ask ${q.ask.toFixed(2)}, ${q.spreadTicks} tick${q.spreadTicks > 1 ? "s" : ""} wide, ${q.depth} lots at the touch. A round trip of one lot costs the spread: ${usd((q.ask - q.bid) * 1000)}.` : "Not yet: no quote."; },
    showMe: { screen: "markets", target: "ticket-touch", label: "the bid and ask on the ticket" },
    terms: [{ term: "bid", definition: "The highest price a buyer will pay right now." }, { term: "ask", definition: "The lowest price a seller will take right now." }, { term: "depth", definition: "Lots available at the best bid or ask." }, { term: "slippage", definition: "The extra paid when an order is bigger than the depth at the touch." }],
  },
  {
    id: "tick_and_settle", title: "A tick and a settle", level: 0, diagram: "none",
    sentences: ["A tick is the smallest price step the exchange quotes: one cent for crude, a hundredth of a cent for products.", "The settle is the official closing price each session; it marks every open position and moves cash as variation margin.", "The clock here runs an hour a tick; the settle is at 19:00 and the session closes there."],
    worked: (s) => { const spec = INSTRUMENTS.BRENT; const c = s.contracts[ckey("BRENT", s.listed.BRENT[0])]; return c?.settle ? `Last Brent settle ${c.settle.v.toFixed(2)} at tick ${c.settle.at}; one tick (${spec.tick}) on one lot is ${usd(spec.tick * spec.lot)}.` : `No settle yet this level: the first comes at 19:00. One tick (${spec.tick}) on one lot is ${usd(spec.tick * spec.lot)}.`; },
    showMe: { screen: "markets", target: "curve", label: "the settle column on the curve" },
    terms: [{ term: "tick", definition: "The minimum price increment of a contract." }, { term: "settle", definition: "The official daily closing price used to mark positions." }],
  },
  {
    id: "initial_variation_margin", title: "Initial and variation margin", level: 1, diagram: "margin",
    sentences: ["Initial margin is a deposit the clearer holds against your open position, a share of notional; it comes back when you close.", "Variation margin is the day's P&L, paid or received in cash at every settle, so losses leave your account before you have decided anything.", "A margin call is the clearer asking for cash you do not have; the only ways out are to fund it or to cut the book."],
    worked: (s) => s.finance.marginRequired > 0 ? `Your book needs ${usd(s.finance.marginRequired)} of initial margin now; the last settle moved ${usd(s.finance.ledger.filter((r) => r.kind === "variation_margin").slice(-1)[0]?.amount ?? 0)} of variation margin.` : `No position yet: 100 Brent lots at ${frontQuote(s)?.mid.toFixed(2) ?? "?"} would need ${usd(0.08 * (frontQuote(s)?.mid ?? 0) * 1000 * 100)} of initial margin (8% of notional).`,
    showMe: { screen: "finance", target: "margin", label: "the margin account" },
    terms: [{ term: "initial margin", definition: "The deposit held against an open futures position." }, { term: "variation margin", definition: "The daily P&L settled in cash." }, { term: "margin call", definition: "A demand for cash when the account cannot cover variation margin." }],
  },
  {
    id: "size_before_direction", title: "Size before direction", level: 1, diagram: "none",
    sentences: ["Decide how much you can lose before you decide which way you lean: the limit is the budget, the view is how you spend it.", "VaR says what a bad day costs on the current book; lots that put VaR above the limit are lots the risk manager will take from you.", "A position sized to the whole line survives nothing: one ordinary bad day and the clearer owns your book."],
    worked: (s) => s.risk.var95 && s.risk.var95.v > 0 ? `Your VaR is ${usd(s.risk.var95.v)} against a limit of ${usd(s.risk.limits.var95)}: ${(100 * s.risk.var95.v / s.risk.limits.var95).toFixed(0)}% used.` : `Your limit is ${usd(s.risk.limits.var95)} of one-day VaR. Buy a few lots, read the VaR, and scale to the limit from there.`,
    showMe: { screen: "book", target: "var", label: "the VaR gauge" },
    terms: [{ term: "VaR", definition: "Value at risk: the loss not exceeded on a stated share of days, here 95% of simulated one-day moves." }, { term: "limit", definition: "The most risk the desk lets you carry." }],
  },
  {
    id: "mark_to_market", title: "Mark-to-market", level: 1, diagram: "none",
    sentences: ["Your position is worth what the market would pay for it now, not what you paid: the mark is the mid, and the P&L is the mark minus your entry.", "Between settles the P&L is unrealised; at the settle it becomes cash, and the next day starts from the settle.", "Every number on this desk explains itself on hover: the mark names the mid it used and the tick it was taken at."],
    worked: (s) => s.lots.length ? `Open lots marked at the mid: unrealised ${usd(s.pnl.unrealised)} since the last settle; level P&L ${usd(s.pnl.total)}.` : "No open lots: nothing to mark. Buy one and hover the P&L.",
    showMe: { screen: "book", target: "positions", label: "the positions table" },
    terms: [{ term: "mark", definition: "The price a position is valued at, the current mid or the last settle." }, { term: "unrealised", definition: "P&L not yet settled into cash." }],
  },
  {
    id: "contango_storage_price", title: "Contango is a storage price", level: 2, diagram: "curve_contango",
    sentences: ["When later months trade above nearer ones, the market is paying someone to hold the barrel: the spread is the price of storage plus the money tied up.", "That happens when stocks are high; the curve says there is more oil than anyone needs now.", "A long in contango pays that price as the contract rolls down the curve toward spot."],
    worked: (s) => { const m = s.listed.BRENT; const a = s.quotes[ckey("BRENT", m[0])], b = s.quotes[ckey("BRENT", m[1])]; return a && b ? `Brent ${m[1]} minus ${m[0]} is ${(b.mid - a.mid).toFixed(2)} $/bbl: ${b.mid > a.mid ? "contango" : "backwardation"}. Full carry at Rotterdam is about ${fullCarry("BRENT", a.mid, s.world.baseRate).toFixed(2)} a month.` : "Not yet."; },
    showMe: { screen: "markets", target: "curve", label: "the Brent curve" },
    terms: [{ term: "contango", definition: "A curve where later months are dearer than nearer months." }, { term: "term structure", definition: "The shape of prices across delivery months." }],
  },
  {
    id: "roll_yield", title: "Roll yield", level: 2, diagram: "timeline",
    sentences: ["A futures contract expires; to keep the position you sell the expiring month and buy the next, and the difference is the roll.", "In contango you sell low and buy high, and then the new month drifts down toward spot: the roll costs you.", "In backwardation it is the reverse and the roll pays you, which is why a long in a backwardated market earns even when flat price goes nowhere."],
    worked: (s) => { const rolls = s.fills.filter((f) => f.tag === "roll"); const ts = s.pnl.attribution.filter((r) => r.leg === "time_spread").reduce((a, r) => a + r.amount, 0); return rolls.length ? `You have rolled ${rolls.length / 2} time${rolls.length > 2 ? "s" : ""}; the time-spread leg of your P&L is ${usd(ts)} so far.` : `No roll yet. The time-spread leg of your P&L is ${usd(ts)}: that is the curve working on your position.`; },
    showMe: { screen: "book", target: "waterfall", label: "the time-spread bar" },
    terms: [{ term: "roll", definition: "Closing the expiring month and opening the next." }, { term: "roll yield", definition: "The P&L from a contract converging along the curve as it nears expiry." }, { term: "expiry", definition: "The last day a contract trades." }],
  },
  {
    id: "full_carry", title: "Full carry", level: 2, diagram: "curve_contango",
    sentences: ["Contango cannot exceed the cost of storing a barrel for a month plus the interest on its price for long: beyond that anyone can buy, store and sell forward for a sure profit.", "That ceiling is full carry; the curve sits at or below it, and how far below says how badly the market wants barrels now.", "Backwardation has no such ceiling: nothing stops a prompt barrel being worth much more than a deferred one."],
    worked: (s) => { const q = frontQuote(s); return q ? `Full carry on Brent now: storage 0.60 + ${q.mid.toFixed(2)} x ${(s.world.baseRate * 100).toFixed(2)}% / 12 = ${fullCarry("BRENT", q.mid, s.world.baseRate).toFixed(2)} $/bbl a month (stylised).` : "Not yet."; },
    showMe: { screen: "markets", target: "spreads", label: "the spreads table" },
    terms: [{ term: "full carry", definition: "Storage cost plus financing: the most contango a curve can hold." }, { term: "cash and carry", definition: "Buying prompt, storing, and selling forward to earn the contango." }],
  },
  {
    id: "backwardation_pays_long", title: "Backwardation pays the long", level: 2, diagram: "curve_backwardation",
    sentences: ["When nearer months trade above later ones the market is short of prompt barrels and pays a premium to get them now.", "A long position rolls up the curve: each day the contract drifts toward the higher prompt price.", "The steeper the backwardation, the tighter the prompt, and the more a long earns for simply being there."],
    worked: (s) => { const ts = s.pnl.attribution.filter((r) => r.leg === "time_spread").reduce((a, r) => a + r.amount, 0); return `Your time-spread leg is ${usd(ts)} this level; the front spread is ${s.factors.spread1.BRENT.toFixed(2)} $/bbl a month (positive is contango).`; },
    showMe: { screen: "markets", target: "curve", label: "the Brent curve" },
    terms: [{ term: "backwardation", definition: "A curve where nearer months are dearer than later months." }, { term: "prompt", definition: "The nearest delivery; the here-and-now barrel." }],
  },
  {
    id: "spread_is_a_view", title: "A spread is a view on a relationship", level: 3, diagram: "spread",
    sentences: ["A spread is long one thing and short another: you no longer care where the flat price goes, only where the gap between the two goes.", "The exchange knows the legs offset and asks for less margin; the risk is smaller but it is not zero.", "Trade a spread as one package so both legs fill together; legging in leaves you with a flat-price position you did not want."],
    worked: (s) => { const pk = new Set(s.fills.filter((f) => f.packageId).map((f) => f.packageId)).size; return pk ? `You have traded ${pk} package${pk > 1 ? "s" : ""}; the flat leg of your P&L is ${usd(s.pnl.attribution.filter((r) => r.leg === "flat").reduce((a, r) => a + r.amount, 0))} against spread legs of ${usd(s.pnl.attribution.filter((r) => ["basis", "time_spread", "crack"].includes(r.leg)).reduce((a, r) => a + r.amount, 0))}.` : "No package yet: open the ticket's spread tab."; },
    showMe: { screen: "markets", target: "ticket-spread", label: "the spread tab on the ticket" },
    terms: [{ term: "spread", definition: "A long and a short held together as a view on their difference." }, { term: "package", definition: "A spread traded as one order so both legs fill at once." }, { term: "margin offset", definition: "The reduction in initial margin for offsetting legs." }],
  },
  {
    id: "brent_wti_pipeline_ship", title: "Brent-WTI is a pipeline and a ship", level: 3, diagram: "spread",
    sentences: ["WTI prices at Cushing, Oklahoma, a landlocked tank farm; Brent prices on the water in the North Sea.", "When Cushing fills, WTI must cheapen until it pays to pipe the barrel to the coast and ship it to Europe: the spread widens to the cost of that journey.", "It cannot stay wider than that for long, because exporters close the gap one cargo at a time."],
    worked: (s) => `Brent minus WTI is ${s.factors.bw.toFixed(2)} $/bbl now; the stylised cost of moving a barrel from Houston to Rotterdam is about $3.00, so the arb is ${s.factors.bw > 3 ? "open" : "closed"}.`,
    showMe: { screen: "markets", target: "spreads", label: "the Brent-WTI row" },
    terms: [{ term: "Brent-WTI", definition: "The spread between the seaborne and the landlocked crude benchmarks." }, { term: "arb", definition: "Arbitrage: a price gap larger than the cost of closing it." }],
  },
  {
    id: "crack_refinery_margin", title: "The crack is a refinery's margin", level: 3, diagram: "crack",
    sentences: ["A refinery buys crude and sells products; the crack is the product price minus the crude price, its gross margin per barrel.", "The 3-2-1 crack is three barrels of crude into two of gasoline and one of diesel, the mix a simple US refinery makes.", "When refineries shut for maintenance less product is made and the crack strengthens; when they run hard it weakens."],
    worked: (s) => { const rb = s.quotes[ckey("RBOB", s.listed.RBOB[0])], ho = s.quotes[ckey("ULSD", s.listed.ULSD[0])], cl = s.quotes[ckey("WTI", s.listed.WTI[0])]; return rb && ho && cl ? `3-2-1 now: (2 x ${(rb.mid * 42).toFixed(2)} + ${(ho.mid * 42).toFixed(2)} - 3 x ${cl.mid.toFixed(2)}) / 3 = ${((2 * rb.mid * 42 + ho.mid * 42 - 3 * cl.mid) / 3).toFixed(2)} $/bbl. Refinery runs are at ${(s.world.refineryRuns * 100).toFixed(0)}% of capacity.` : "Not yet: products are not listed in this level."; },
    showMe: { screen: "markets", target: "spreads", label: "the 3-2-1 row" },
    terms: [{ term: "crack", definition: "Product price minus crude price: a refining margin." }, { term: "3-2-1", definition: "Three crude into two gasoline and one diesel, as a tradable package." }, { term: "turnaround", definition: "Planned refinery maintenance that cuts runs." }],
  },
  {
    id: "expected_vs_actual", title: "Expected versus actual", level: 4, diagram: "release",
    sentences: ["A number only moves the market by the part nobody expected: the consensus is already in the price before the print.", "A build bigger than consensus is bearish even in a drawing market; a draw smaller than consensus is bearish too.", "Size into a release for the surprise, not the number: the move at 15:00 can be the whole week's range in a minute."],
    worked: (s) => { const r = s.releases.filter((x) => x.published && x.actual && x.consensus).slice(-1)[0]; return r ? `Last print: ${r.actual!.v >= 0 ? "+" : ""}${r.actual!.v.toFixed(1)} mb against ${r.consensus!.v >= 0 ? "+" : ""}${r.consensus!.v.toFixed(1)} expected: a ${(r.actual!.v - r.consensus!.v).toFixed(1)} mb surprise.` : "No release published yet this level: check the calendar on Intel."; },
    showMe: { screen: "intel", target: "calendar", label: "the release calendar" },
    terms: [{ term: "consensus", definition: "The average forecast before a release." }, { term: "surprise", definition: "Actual minus consensus: the part of a release that moves prices." }],
  },
  {
    id: "positioning_is_a_crowd", title: "Positioning is a crowd", level: 4, diagram: "none",
    sentences: ["The positioning report says how long or short the speculators already are; a crowded position is one that has already been bought.", "A crowded long needs new buyers to rise and has many sellers when it falls, so the exits are narrow.", "Use it as a tail risk, not a signal: know who is on your side of the boat before the weather turns."],
    worked: (s) => { const n = s.news.filter((x) => x.headline.startsWith("Managed money")).slice(-1)[0]; return n ? `Latest report: ${n.headline}.` : "No positioning report yet: they come on Fridays."; },
    showMe: { screen: "intel", target: "news", label: "the positioning headline" },
    terms: [{ term: "positioning", definition: "The aggregate long or short of a class of traders, published weekly." }, { term: "crowded", definition: "A position most of the market already holds." }],
  },
  {
    id: "rumour_base_rate", title: "A rumour has a base rate", level: 4, diagram: "none",
    sentences: ["A leak before a meeting is right about two times in three; it moves the price now and the decision moves it again tomorrow.", "Trading the leak means betting on the base rate, with the market already paying part of it.", "Every rumour on this desk is resolved on screen afterwards, true or false, so you can learn the rate rather than the story."],
    worked: (s) => { const leaks = s.news.filter((x) => x.source === "leak"); const resolved = leaks.filter((x) => x.resolved); return leaks.length ? `${leaks.length} leak${leaks.length > 1 ? "s" : ""} this level, ${resolved.length} resolved: ${resolved.map((x) => x.resolved!.outcome).join(", ") || "pending"}.` : "No leak yet. Watch Intel the day before the OPEC+ meeting."; },
    showMe: { screen: "intel", target: "news", label: "the leak and its resolution" },
    terms: [{ term: "leak", definition: "Unofficial information before an official decision." }, { term: "base rate", definition: "How often a kind of claim turns out true." }],
  },
  {
    id: "turnaround_is_supply", title: "A turnaround is a supply event", level: 14, diagram: "crack",
    sentences: ["When a refinery goes down for maintenance it stops buying crude and stops making product.", "Product cracks strengthen and the crude it would have bought looks for another home.", "A maintenance season is the same thing across many plants at once."],
    worked: (s) => `Refinery runs are at ${(s.world.refineryRuns * 100).toFixed(0)}% of capacity now.`,
    showMe: { screen: "markets", target: "spreads", label: "the 3-2-1 row" },
    terms: [{ term: "runs", definition: "How much crude a refinery is processing, as a share of capacity." }],
  },
];

export const cardById = (id: string): Card | undefined => CARDS.find((c) => c.id === id);
export const cardsForLevel = (level: number): Card[] => CARDS.filter((c) => c.level === level);
