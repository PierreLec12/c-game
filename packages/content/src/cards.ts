/**
 * Concept cards: a titled panel with one diagram where it helps, three sentences, a worked number from the
 * player's own book, and a "show me" target. Tier 0 and tier 1 cards ship in milestone 1.
 */
import { INSTRUMENTS, ckey, type State, fullCarry, cargoMark, physicalExposureBbl, GRADES, PORTS, windowText, legMark, CHOKEPOINT_SPECS, VESSEL_CLASSES, COUNTERPARTIES, counterpartyExposure, lineAvailable, lcCommitted, tankInventory, parcelDiff, FINANCE, CREDIT } from "@desk/engine";

export type Diagram = "none" | "bidask" | "curve_contango" | "curve_backwardation" | "margin" | "timeline" | "spread" | "crack" | "release" | "incoterms" | "window" | "hedge" | "basis" | "chokepoint" | "freight" | "money" | "concentration" | "var" | "carry";

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

  // ---------------------------------------------------------------- tier 2: the cargo and the hedge
  {
    id: "fob_cif_des", title: "FOB, CIF, DES", level: 5, diagram: "incoterms",
    sentences: ["FOB means the seller's job ends at the load port rail: you fix the ship, you pay the freight, you carry the risk at sea.", "CIF means the seller delivers to the discharge port with freight and insurance in the price; DES is the same with title passing at the ship's rail on arrival.", "The letters decide who owns the barrels on the water, who pays the ship, and whose problem a late berth is."],
    worked: (s) => { const c = s.cargoes[0]; return c ? `${GRADES[c.grade].name} ${c.id}: bought ${c.purchase.incoterm} ${PORTS[c.loadPort].name}${c.sale ? `, sold ${c.sale.incoterm} ${PORTS[c.sale.port].name}` : ""}. ${c.purchase.incoterm === "FOB" ? "You pay the freight: " + (c.freight.fixedUsd ? usd(c.freight.fixedUsd) + " fixed" : usd(c.freight.expectedUsd) + " expected") : "Freight is in the purchase price."}` : "No cargo yet: accept the offer on the Desk and read the terms."; },
    showMe: { screen: "desk", target: "cargoes", label: "the cargo card" },
    terms: [{ term: "FOB", definition: "Free on board: the buyer takes the oil at the load port and pays the ship." }, { term: "CIF", definition: "Cost, insurance and freight: the seller delivers to the discharge port." }, { term: "DES", definition: "Delivered ex ship: title passes at the discharge port on arrival." }],
  },
  {
    id: "laycan_bl", title: "Laycan and B/L", level: 5, diagram: "timeline",
    sentences: ["The laycan is the window in which the ship must present to load; miss it and the seller can walk away.", "The bill of lading is signed when loading completes: it is the date the pricing window anchors on and the moment the oil becomes yours.", "Everything downstream counts from the B/L: the window, the invoice, the hedge."],
    worked: (s) => { const c = s.cargoes[0]; return c ? (c.blTick !== null ? `${c.id}: B/L signed on day ${Math.floor(c.blTick / 24)}; the purchase prices over days ${c.purchase.windowDays?.join(", ")}.` : `${c.id}: laycan days ${c.laycan[0]} to ${c.laycan[1]}; ${c.vesselId ? "the ship is fixed" : "no ship fixed yet"}.`) : "No cargo yet."; },
    showMe: { screen: "desk", target: "cargoes", label: "the window timeline on the cargo card" },
    terms: [{ term: "laycan", definition: "Laydays and cancelling: the window in which the vessel must arrive to load." }, { term: "bill of lading", definition: "The document signed when loading completes; its date anchors the pricing window." }],
  },
  {
    id: "window_is_exposure", title: "A pricing window is an exposure", level: 5, diagram: "window",
    sentences: ["A cargo bought at Dated plus a differential has no price until its window prints: until then every dollar the market moves is yours.", "Between the purchase window and the sale window you are long the barrels outright; before the purchase prices you are short them, and after the sale prices you are flat.", "The exposure is the unpriced share of each leg times the cargo size, and it changes every day a window prints."],
    worked: (s) => { const e = physicalExposureBbl(s); const c = s.cargoes[0]; if (!c) return "No cargo yet."; const p = legMark(s, c, c.purchase); return `Net physical exposure ${Math.round(e.bbl).toLocaleString()} bbl: purchase ${p.unpriced.length} of ${p.n} days unpriced${c.sale ? `, sale ${legMark(s, c, c.sale).unpriced.length} of ${legMark(s, c, c.sale).n} days unpriced` : ", unsold"}. A $1 move is ${usd(Math.abs(e.bbl))}.`; },
    showMe: { screen: "desk", target: "cargoes", label: "the hedge coverage bar" },
    terms: [{ term: "pricing window", definition: "The days whose assessments average into a cargo's price." }, { term: "unpriced", definition: "Barrels whose price is not yet known: a flat-price exposure." }],
  },
  {
    id: "lots_from_barrels", title: "Lots from barrels", level: 6, diagram: "hedge",
    sentences: ["A Brent lot is 1,000 barrels, so a 600,000-barrel cargo is 600 lots: the hedge ratio is one when the lots match the barrels.", "Hedge the unpriced barrels, not the cargo: as each window day prints, a fifth of the exposure goes away and a fifth of the hedge should go with it.", "Round to whole lots and accept the residual; a hedge that is 2% off is a hedge, a hedge in the wrong month is a roll you have not done yet."],
    worked: (s) => { const c = s.cargoes[0]; const e = physicalExposureBbl(s); const net = s.lots.filter((l) => l.inst === "BRENT").reduce((a, l) => a + l.qty, 0); return c ? `${c.bbl.toLocaleString()} bbl = ${Math.round(c.bbl / 1000)} lots. Net physical ${Math.round(e.bbl).toLocaleString()} bbl against ${net} Brent lots: ratio ${e.bbl !== 0 ? (-(net * 1000) / e.bbl).toFixed(2) : "n/a"}.` : "No cargo yet."; },
    showMe: { screen: "markets", target: "ticket-qty", label: "the lots field, tagged hedge" },
    terms: [{ term: "hedge ratio", definition: "Futures barrels sold over physical barrels exposed; one is flat." }],
  },
  {
    id: "hedge_the_window", title: "Hedge the window, not the cargo", level: 6, diagram: "window",
    sentences: ["The cargo is not the exposure; the unpriced days are. Sell futures as the purchase prices, buy them back as the sale prices.", "Use a futures month that outlives the window: a hedge in a contract that expires mid-voyage is cash-settled and leaves you naked.", "When the attribution shows a quiet flat-price leg and a live basis leg, the hedge is doing its job."],
    worked: (s) => { const c = s.cargoes[0]; if (!c) return "No cargo yet."; const front = s.listed.BRENT[0]; const exp = s.contracts[`BRENT:${front}`]; const lastDay = Math.max(...(c.sale?.windowDays ?? c.purchase.windowDays ?? [c.laycan[1] + 10])); return `Front Brent ${front} expires on day ${Math.floor(exp.expiryTick / 24)}; your last window day is about day ${lastDay}: ${Math.floor(exp.expiryTick / 24) < lastDay ? "the front would expire inside the window, use the next month" : "the front outlives the window"}.`; },
    showMe: { screen: "markets", target: "curve", label: "the expiry column" },
    terms: [{ term: "expiry roll", definition: "Moving a hedge to a later month before the near one expires." }],
  },
  {
    id: "basis_is_the_gap", title: "The gap between hedge and cargo is basis", level: 6, diagram: "basis",
    sentences: ["Futures hedge the flat price; the cargo prices on Dated plus a differential, and Dated minus futures moves on its own.", "What is left after the hedge is basis: the Dated differential, the grade differential, and timing between the window and the contract.", "Basis is smaller than flat price and it is where a physical trader earns or loses the margin."],
    worked: (s) => { const b = s.pnl.attribution.filter((r) => r.leg === "basis").reduce((a, r) => a + r.amount, 0); const f = s.pnl.attribution.filter((r) => r.leg === "flat").reduce((a, r) => a + r.amount, 0); return `This level: flat-price leg ${usd(f)}, basis leg ${usd(b)}. Dated minus front is ${s.factors.datedDiff.toFixed(2)} now.`; },
    showMe: { screen: "book", target: "waterfall", label: "the basis bar" },
    terms: [{ term: "basis risk", definition: "The part of a hedged position the hedge does not cover: differentials and timing." }],
  },
  {
    id: "basis_risk", title: "Basis risk", level: 7, diagram: "basis",
    sentences: ["A grade differential is a price of its own: Bonny Light over Dated moves with West African loadings and with what refiners want this month.", "An unsold cargo is long that differential; selling it fixes it. Waiting to sell is a view on the differential whether you meant it or not.", "A quality claim is basis too: the barrels were not quite what the differential paid for."],
    worked: (s) => { const c = s.cargoes[0]; return c ? `${GRADES[c.grade].name} market differential ${s.factors.gradeDiffs[c.grade] >= 0 ? "+" : ""}${s.factors.gradeDiffs[c.grade].toFixed(2)} over ${GRADES[c.grade].benchmark}; you bought at ${c.purchase.diff >= 0 ? "+" : ""}${c.purchase.diff.toFixed(2)}${c.sale ? `, sold at ${c.sale.diff >= 0 ? "+" : ""}${c.sale.diff.toFixed(2)} over ${c.sale.basis}` : ", unsold"}.` : "No cargo yet."; },
    showMe: { screen: "desk", target: "cargoes", label: "the differential on the cargo card" },
    terms: [{ term: "grade differential", definition: "A grade's price over or under its benchmark, set by quality and location." }],
  },
  {
    id: "why_dubai", title: "Why Dubai", level: 7, diagram: "spread",
    sentences: ["Asia prices crude against Dubai, a medium sour benchmark; Europe prices against Dated Brent, light and sweet.", "A cargo bought on Dated and sold on Dubai is long Brent-Dubai, the East-West spread, until the sale prices.", "The East-West spread moves with Gulf loadings, Asian runs and the risk index; hedge it with the Dubai swap, or know you have not."],
    worked: (s) => { const c = s.cargoes[0]; const ew = s.factors.dubaiEW; const dub = s.lots.filter((l) => l.inst === "DUBAI").reduce((a, l) => a + l.qty, 0); return `Brent minus Dubai is ${ew.toFixed(2)} now. ${c && c.sale && c.sale.basis === "DUBAI" ? `Your sale prices on Dubai: ${Math.round(c.bbl / 1000)} lots of East-West exposure, ${dub} Dubai swap lots held against it.` : "No Dubai-priced sale yet."}`; },
    showMe: { screen: "markets", target: "spreads", label: "the Brent-Dubai row" },
    terms: [{ term: "Dubai", definition: "The medium sour benchmark Asian cargoes price against." }, { term: "East-West spread", definition: "Brent minus Dubai: the spread between the Atlantic and Asian benchmarks." }],
  },
  {
    id: "efp", title: "EFP: paper for the cargo", level: 7, diagram: "hedge",
    sentences: ["An exchange of futures for physical fixes the unpriced part of a cargo at today's assessment and hands over the matching futures at the same price.", "No spread is crossed: the paper and the physical change hands together, which is why EFPs price cargoes without a window fight.", "Use it to turn a floating cargo into a fixed one in a single step when you have the paper against it."],
    worked: (s) => { const c = s.cargoes.find((x) => x.purchase.fixed === null || (x.sale && x.sale.fixed === null)); return c ? `${c.id}: the ${c.purchase.fixed === null ? "purchase" : "sale"} still has unpriced days; an EFP would fix them at today's ${c.purchase.basis} assessment.` : "Every leg is priced: nothing to EFP."; },
    showMe: { screen: "desk", target: "cargoes", label: "the EFP button on the cargo card" },
    terms: [{ term: "EFP", definition: "Exchange of futures for physical: fixing a cargo price by handing over futures at the same price." }],
  },
  {
    id: "window_mismatch", title: "Window mismatch is a spread", level: 8, diagram: "window",
    sentences: ["Buy on a month average and sell on five days a month later and you are short the first period and long the second: a time spread you did not choose.", "The curve already prices that gap: in contango it pays you, in backwardation it costs you, before the market moves at all.", "Hedge it with a time spread in the same direction as the gap, or change the window in the contract."],
    worked: (s) => { const t = s.pnl.attribution.filter((r) => r.leg === "time_spread").reduce((a, r) => a + r.amount, 0); const c = s.cargoes[0]; return c ? `${c.id}: purchase prices ${windowText(c.purchase.window)}${c.sale ? `, sale ${windowText(c.sale.window)}` : ""}. Time-spread leg so far ${usd(t)}; the front Brent spread is ${s.factors.spread1.BRENT.toFixed(2)} a month.` : "No cargo yet."; },
    showMe: { screen: "book", target: "waterfall", label: "the time-spread bar" },
    terms: [{ term: "window mismatch", definition: "Purchase and sale windows in different periods: an implicit time spread." }],
  },
  {
    id: "backwardation_taxes", title: "Backwardation taxes the long cargo", level: 8, diagram: "curve_backwardation",
    sentences: ["A cargo priced early and sold late in a backwardated market sells into a lower forward price: the curve charges you for carrying it.", "Each day the sale window stays open, its forward value rolls down; the mark bleeds without the flat price moving.", "In contango the same cargo earns carry, which is why floating storage appears when the curve pays for it."],
    worked: (s) => `Front Brent spread ${s.factors.spread1.BRENT.toFixed(2)} $/bbl a month: ${s.factors.spread1.BRENT < 0 ? "backwardation; a month of delay costs about " + usd(Math.abs(s.factors.spread1.BRENT) * (s.cargoes[0]?.bbl ?? 600000)) : "contango; a month of delay earns about " + usd(s.factors.spread1.BRENT * (s.cargoes[0]?.bbl ?? 600000))} on the cargo.`,
    showMe: { screen: "markets", target: "curve", label: "the Brent curve" },
    terms: [{ term: "roll-down", definition: "A forward price converging along the curve as its date approaches." }],
  },
  {
    id: "deemed_bl", title: "Deemed B/L", level: 8, diagram: "timeline",
    sentences: ["A deemed bill of lading fixes the pricing anchor on a stated date whatever the ship does.", "It takes the timing out of the seller's hands: a late ship no longer moves the window.", "Use it when the window matters more than the voyage; pay for it in the differential."],
    worked: (s) => { const c = s.cargoes.find((x) => x.purchase.window.kind === "deemed" || x.sale?.window.kind === "deemed"); return c ? `${c.id} has a deemed window: ${windowText(c.purchase.window.kind === "deemed" ? c.purchase.window : c.sale!.window)}.` : "No deemed window on the book; the tenders say when one is on offer."; },
    showMe: { screen: "desk", target: "tenders", label: "the window column in the tenders" },
    terms: [{ term: "deemed B/L", definition: "A contractual pricing date used instead of the actual bill of lading date." }],
  },
  {
    id: "freight_share", title: "Freight is a share of the barrel", level: 9, diagram: "freight",
    sentences: ["A voyage charter is a lump sum: hire per day times the days, plus port time and the owner's margin; divide by the barrels and it is a price per barrel.", "On a VLCC from the Gulf to Rotterdam that share is a dollar or two; on a small ship or a long detour it can be the whole margin.", "Worldscale is the same number expressed against a flat rate; it is a card, not a quote, on this desk."],
    worked: (s) => { const c = s.cargoes[0]; if (!c) return "No cargo yet."; const f = c.freight.fixedUsd ?? c.freight.expectedUsd; return `${c.id}: freight ${usd(f)} on ${c.bbl.toLocaleString()} bbl = ${(f / c.bbl).toFixed(2)} $/bbl, ${((f / c.bbl) / Math.max(1, s.factors.brentPrompt) * 100).toFixed(1)}% of the barrel. Freight index ${s.factors.freightIndex.toFixed(2)} (1 = base hire, stylised).`; },
    showMe: { screen: "map", target: "route", label: "the route callout" },
    terms: [{ term: "voyage charter", definition: "Hiring a ship for one voyage at a lump sum or per tonne." }, { term: "Worldscale", definition: "A freight scale: a percentage of a published flat rate per route." }, { term: "demurrage", definition: "What the charterer pays when a ship waits beyond its laytime." }],
  },
  {
    id: "chokepoint_is_a_spread", title: "A chokepoint is a time spread and a freight shock at once", level: 9, diagram: "chokepoint",
    sentences: ["Close a strait and every ship behind it takes the long way round: tonne-miles rise, hire rises, and the barrels arrive later.", "Later barrels at the destination tighten the prompt there and loosen it at the source: a geographic spread and a time spread move together.", "A ship already at the strait chooses between war risk and waiting, or the detour; the cost of each is on the callout."],
    worked: (s) => { const cps = Object.values(s.chokepoints).filter((c) => c.status !== "open"); return cps.length ? cps.map((c) => `${CHOKEPOINT_SPECS[c.id].name} ${c.status} since tick ${c.since}: war risk ${CHOKEPOINT_SPECS[c.id].warRiskUsdPerBbl.value.toFixed(2)} $/bbl, convoy delay ${CHOKEPOINT_SPECS[c.id].restrictedDelayDays.value} days (stylised).`).join(" ") : "Every passage is open. Freight index " + s.factors.freightIndex.toFixed(2) + "."; },
    showMe: { screen: "map", target: "chokepoints", label: "the chokepoints on the map" },
    terms: [{ term: "chokepoint", definition: "A narrow passage a large share of seaborne oil moves through." }, { term: "war risk", definition: "An insurance premium to transit a dangerous passage." }],
  },
  {
    id: "storage_on_water", title: "Storage on water", level: 9, diagram: "curve_contango",
    sentences: ["A ship at anchor is a tank that costs its hire every day; the contango has to pay more than that for the wait to make sense.", "When it does, cargoes slow down, anchor off the discharge port, and sell into a later, higher window.", "When it does not, every day at anchor is a loss; the number to watch is the front spread against hire per barrel per day."],
    worked: (s) => { const c = s.cargoes[0]; const v = s.voyages.find((x) => x.id === c?.voyageId); if (!c || !v) return "No ship under way."; const perDay = v.hireUsdPerDay / c.bbl; const carryPerDay = s.factors.spread1.BRENT / 30.4; return `Hire ${usd(v.hireUsdPerDay)} a day = ${perDay.toFixed(3)} $/bbl a day; the curve pays ${carryPerDay.toFixed(3)} $/bbl a day of contango: ${carryPerDay > perDay ? "storage on water pays" : "waiting loses money"}.`; },
    showMe: { screen: "desk", target: "cargoes", label: "the anchor control on the cargo card" },
    terms: [{ term: "floating storage", definition: "Holding oil on a chartered ship at anchor to sell into a later window." }],
  },

  // ---------------------------------------------------------------- tier 3: money, counterparties, limits
  {
    id: "cost_of_carry_money", title: "Cost of carry includes money", level: 10, diagram: "money",
    sentences: ["Between paying for a cargo and being paid for it, the money comes from the line, and the line charges interest every day.", "On an $80m cargo at base plus 150 basis points, a month costs about $370,000: a third of a dollar a barrel before freight or storage.", "Every day a counterparty pays late, every day a window is deferred, is a day of interest on someone's balance sheet, usually yours."],
    worked: (s) => `Line drawn ${usd(s.finance.lineDrawn)} at ${((s.world.baseRate + FINANCE.lineSpreadBp.value / 10000) * 100).toFixed(2)}%: ${usd((s.finance.lineDrawn * (s.world.baseRate + FINANCE.lineSpreadBp.value / 10000)) / 365)} a day. Interest paid this level ${usd(s.finance.interestAccrued)}; finance leg ${usd(s.pnl.attribution.filter((r) => r.leg === "finance").reduce((a, r) => a + r.amount, 0))}.`,
    showMe: { screen: "finance", target: "margin", label: "the credit line" },
    terms: [{ term: "working capital", definition: "The money tied up between paying for oil and being paid for it." }, { term: "financing cost", definition: "Interest on the line for the days the money is out." }],
  },
  {
    id: "lc_promise_fee", title: "A letter of credit is a promise and a fee", level: 10, diagram: "money",
    sentences: ["A producer who does not know you wants the bank's promise, not yours: a letter of credit pays them when the documents say the oil was loaded.", "It costs a fee on the face value every quarter, and the face comes off the line until the invoice is paid, so an open LC is credit you cannot use for anything else.", "Three cargoes with letters of credit can be a bigger line than you have; the third one is the one you decline, with a reason."],
    worked: (s) => `Open letters of credit hold ${usd(lcCommitted(s))} of the line; ${usd(lineAvailable(s))} is left to draw or commit. Fee ${(FINANCE.lcFeePerQuarter.value * 100).toFixed(2)}% of face per quarter (stylised).`,
    showMe: { screen: "finance", target: "lcs", label: "the letters of credit" },
    terms: [{ term: "letter of credit", definition: "A bank's undertaking to pay a seller against shipping documents." }, { term: "face", definition: "The amount a letter of credit is written for." }],
  },
  {
    id: "prepayment_is_a_loan", title: "Prepayment is a loan", level: 10, diagram: "money",
    sentences: ["A producer short of cash will sell cheaper to be paid before the oil prices; the discount is interest you are charging them.", "The money comes off your line the day you pay it, and if they fail to load you are an unsecured creditor of a company that was short of cash.", "Compare the discount to what the line costs you for those days, and to what you think of the name."],
    worked: (s) => { const c = s.cargoes.find((x) => x.prepaidUsd > 0); return c ? `${GRADES[c.grade].name} ${c.id}: prepaid ${usd(c.prepaidUsd)}; the discount of ${CREDIT.prepayDiscountPerBbl.value.toFixed(2)} $/bbl is ${usd(CREDIT.prepayDiscountPerBbl.value * c.bbl)} against interest of about ${usd((c.prepaidUsd * (s.world.baseRate + 0.015) * 30) / 365)} a month.` : `A ${CREDIT.prepayDiscountPerBbl.value.toFixed(2)} $/bbl discount on a million barrels is ${usd(CREDIT.prepayDiscountPerBbl.value * 1e6)}; a month of interest on $80m at ${((s.world.baseRate + 0.015) * 100).toFixed(2)}% is ${usd((80e6 * (s.world.baseRate + 0.015)) / 12)}.`; },
    showMe: { screen: "desk", target: "tenders", label: "the prepay option on an offer" },
    terms: [{ term: "prepayment", definition: "Paying for a cargo before it prices, for a discount." }],
  },
  {
    id: "cheapest_for_a_reason", title: "Cheapest for a reason", level: 11, diagram: "concentration",
    sentences: ["The cheapest offer on the screen comes from the name that needs the trade most, and a name that needs it most is the one most likely not to be there at the laycan.", "A default costs you the edge, the onward sale you cannot deliver, and any money you paid in advance.", "Price the name, not just the barrel: rating, history, and what the cheapness is paying you for."],
    worked: (s) => { const cps = Object.values(s.counterparties).filter((c) => c.defaulted || c.gone); return cps.length ? `${cps.map((c) => `${COUNTERPARTIES[c.id].name} (${c.rating})`).join(", ")} ${cps.length > 1 ? "have" : "has"} defaulted or gone this level. Credit leg ${usd(s.pnl.attribution.filter((r) => r.leg === "credit").reduce((a, r) => a + r.amount, 0))}.` : `Ratings on the Desk: ${Object.values(s.counterparties).filter((c) => COUNTERPARTIES[c.id].type === "trader").map((c) => `${COUNTERPARTIES[c.id].name} ${c.rating}`).join(", ")}.`; },
    showMe: { screen: "desk", target: "counterparties", label: "the counterparty table" },
    terms: [{ term: "default", definition: "A counterparty failing to perform: not loading, not paying." }, { term: "rating", definition: "A letter grade for how likely a name is to perform." }],
  },
  {
    id: "concentration", title: "Concentration", level: 11, diagram: "concentration",
    sentences: ["Exposure to a counterparty is everything they owe you and everything you have paid for and not received: receivables, prepayments, undelivered cargoes.", "The limit is a multiple of capital per name, so that one default is a bad quarter, not the end of the book.", "Diversify across names before you add to the one that is cheapest."],
    worked: (s) => { const cx = counterpartyExposure(s); const w = Object.entries(cx.byId).sort((a, b) => b[1] - a[1])[0]; return w ? `Largest name: ${COUNTERPARTIES[w[0]]?.name ?? w[0]} at ${usd(w[1])}, ${(w[1] / s.capital).toFixed(1)}x capital; the limit is ${s.risk.limits.concentration < 50 ? s.risk.limits.concentration.toFixed(1) + "x" : "off"}.` : "No counterparty exposure yet."; },
    showMe: { screen: "book", target: "limits", label: "the concentration row" },
    terms: [{ term: "concentration", definition: "One counterparty's share of what you are exposed to." }],
  },
  {
    id: "due_diligence", title: "Due diligence is a position", level: 11, diagram: "concentration",
    sentences: ["Insurance against non-performance costs a premium and pays most of the loss; buying it is a view that the name might fail.", "Contesting a claim costs the inspector's re-test and the receiver's costs if you lose, and the name remembers the fight next time it quotes you.", "Checking a counterparty is not free and not optional; treat the cost as part of the trade, like freight."],
    worked: (s) => { const ins = s.cargoes.filter((c) => c.insured).length; const disputes = Object.values(s.counterparties).reduce((a, c) => a + c.disputes, 0); return `${ins} cargo${ins === 1 ? "" : "es"} insured at ${(CREDIT.insurancePremiumShare.value * 100).toFixed(1)}% of value; ${disputes} dispute${disputes === 1 ? "" : "s"} remembered (each one costs you ${CREDIT.disputeEdgePenalty.value.toFixed(2)} $/bbl on that name's next quote).`; },
    showMe: { screen: "desk", target: "cargoes", label: "the insure button on a cargo" },
    terms: [{ term: "non-performance insurance", definition: "Cover that pays most of the loss when a counterparty fails to perform." }],
  },
  {
    id: "var_is_a_quantile", title: "VaR is a quantile, not a maximum", level: 12, diagram: "var",
    sentences: ["A one-day 95% VaR of $2m says one day in twenty loses more than $2m; it says nothing about how much more.", "The stress table does: it re-prices the whole book under a 10% move and a vol shock, and that is the number the risk manager quotes when he warns you.", "When vol doubles, yesterday's VaR is wrong by this morning; the history catches up slowly, the stress table does not need to."],
    worked: (s) => { const w = s.risk.stress.length ? s.risk.stress.reduce((a, r) => (r.pnlChange < a.pnlChange ? r : a), s.risk.stress[0]) : null; return `VaR ${usd(s.risk.var95?.v ?? 0)} against a limit of ${usd(s.risk.limits.var95)}.${w ? ` Worst stress row: ${Math.round(w.priceShock * 100)}% price, ${usd(w.pnlChange)}.` : ""}`; },
    showMe: { screen: "book", target: "var", label: "the stress table" },
    terms: [{ term: "stress test", definition: "Full re-pricing of the book under a stated shock." }],
  },
  {
    id: "gross_vs_net", title: "Gross versus net", level: 12, diagram: "var",
    sentences: ["Net is long minus short; gross is long plus short. A hedged cargo is net flat and gross twice the cargo.", "Gross is what goes wrong when the hedge and the thing it hedges stop moving together: basis, timing, a liquidity gap.", "The risk manager limits both because a flat book can still be enormous."],
    worked: (s) => `Net Brent ${s.risk.netLots.BRENT} lots, gross ${s.risk.grossLots} lots against a gross limit of ${s.risk.limits.grossLots}; physical ${Math.round(physicalExposureBbl(s).bbl).toLocaleString()} bbl.`,
    showMe: { screen: "book", target: "limits", label: "the gross and net rows" },
    terms: [{ term: "gross exposure", definition: "Long plus short, counting both sides." }],
  },
  {
    id: "reduce_before_told", title: "Reduce before you are told", level: 12, diagram: "var",
    sentences: ["A breach at the close is a warning; a second close is a forced cut at the touch; a third is a life. The cheapest exit is the one you choose.", "When the news says vol doubled, the VaR will double at the next close whether or not you look; cut the gross now at your price, not his.", "A request to raise a limit is granted on a clean record and refused on a dirty one; the time to ask is before you need it."],
    worked: (s) => `Closes inside the limit: ${s.risk.closesInsideLimit} of ${s.risk.closesTotal}; forced reductions ${s.risk.forcedReductions}; lives ${s.risk.lives}.${s.risk.breaches.some((b) => b.consecutive > 0) ? " You are in breach now." : ""}`,
    showMe: { screen: "book", target: "limits", label: "the limits table" },
    terms: [{ term: "forced reduction", definition: "The risk manager cutting the book pro rata at the touch." }],
  },
  {
    id: "cash_and_carry", title: "Cash and carry", level: 13, diagram: "carry",
    sentences: ["Buy the prompt barrel, store it, sell the deferred month: the contango is your revenue, storage and money are your costs, and the difference is locked the day you do both.", "Sell the deferred futures or the deferred physical; either way the flat price is gone and what is left is structure against carry.", "When the curve flips to backwardation the prompt barrel is worth more than the deferred one: sell the oil, buy back the paper, and be out before the storage bill."],
    worked: (s) => { const front = s.listed.WTI[0], second = s.listed.WTI[2]; const q1 = s.quotes[ckey("WTI", front)], q2 = s.quotes[ckey("WTI", second)]; return q1 && q2 ? `WTI ${second} minus ${front} is ${(q2.mid - q1.mid).toFixed(2)} $/bbl; two months at Cushing cost ${(2 * 0.35).toFixed(2)} of storage and about ${((q1.mid * (s.world.baseRate + 0.015) * 2) / 12).toFixed(2)} of money: carry ${(q2.mid - q1.mid - 0.7 - (q1.mid * (s.world.baseRate + 0.015) * 2) / 12).toFixed(2)} $/bbl.` : "Not yet."; },
    showMe: { screen: "markets", target: "curve", label: "the WTI curve" },
    terms: [{ term: "carry trade", definition: "Owning stored oil against a deferred sale to earn the contango." }],
  },
  {
    id: "storage_economics", title: "Storage economics", level: 13, diagram: "carry",
    sentences: ["A tank lease is a monthly cost per barrel of capacity whether or not it is full, with a minimum term you pay out if you leave early.", "The tank pays for itself when the spread between the month you fill and the month you empty beats the lease plus the interest on the oil.", "Rotterdam leases price in euros: the tank has an FX leg before it has a barrel in it."],
    worked: (s) => { const t = s.tanks.filter((k) => !k.released); return t.length ? t.map((k) => `Tank ${k.id} at ${PORTS[k.port].name}: ${tankInventory(k).toLocaleString()} of ${k.capacityBbl.toLocaleString()} bbl, ${k.costPerBblMonth.toFixed(2)} ${k.currency}/bbl/month, ${k.chargesPaid} of ${k.months} months paid${k.parcels.length ? `, parcels ${k.parcels.map((p) => `${p.label} at ${parcelDiff(s, p).toFixed(2)}`).join("; ")}` : ""}.`).join(" ") : "No tank leased. Cushing $0.35, Rotterdam 0.55 EUR, Fujairah $0.55, Singapore $0.70 a barrel a month (stylised)."; },
    showMe: { screen: "desk", target: "tanks", label: "the tanks" },
    terms: [{ term: "tank lease", definition: "Capacity rented by the month per barrel, with a minimum term." }],
  },
  {
    id: "blending_to_spec", title: "Blending to a spec", level: 13, diagram: "carry",
    sentences: ["Two parcels in one tank become one parcel at the volume-weighted API and sulphur, and the blend prices on the quality grid, not on either grade's name.", "Sweet into sour lifts the sour barrel more than it costs the sweet one when the grid pays more per point of sulphur than the sweet premium you gave up.", "A blend is a cheaper barrel only if someone buys that quality; check the spec you are selling into before you mix."],
    worked: (s) => { const b = s.tanks.flatMap((k) => k.parcels).find((p) => p.grade === "BLEND"); return b ? `${b.label}: ${b.bbl.toLocaleString()} bbl priced at ${parcelDiff(s, b).toFixed(2)} over ${b.benchmark} on the grid.` : "No blend yet. The grid: 0.12 $/bbl per API degree around 38, 2.00 $/bbl per sulphur point around 0.5% (stylised)."; },
    showMe: { screen: "desk", target: "tanks", label: "the blend button" },
    terms: [{ term: "blend", definition: "Parcels mixed to a target quality." }, { term: "quality grid", definition: "The price of API and sulphur around a reference barrel." }],
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
