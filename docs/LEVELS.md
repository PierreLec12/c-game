# The curriculum as shipped (milestones 1 to 3: levels 0 to 13)

Tiers 0 to 3 of twenty-one levels. Each level is a module in `packages/content/src/levels/level_NN.ts` with the
briefing, the scenario, the objectives, the cards, the quiz, the solution bot, ten seeds and the checked-in par.

| Level | Title | Days | Instruments | Pass rule | Cards |
|---|---|---|---|---|---|
| 0 | Orientation | 1 | Brent | one round trip and six drills of six | What a lot is; Why the ask is above the bid; A tick and a settle |
| 1 | Flat price and margin | 10 | Brent | positive P&L, no margin call, VaR inside the limit at every close | Size before direction; Initial and variation margin; Mark-to-market |
| 2 | Term structure | 56 | Brent | two rolls, nothing expired in the book, VaR inside the limit, correct debrief | Contango is a storage price; Full carry; Roll yield; Backwardation pays the long |
| 3 | Spreads | 20 | Brent, WTI, RBOB, ULSD | two packages, spread P&L in the attribution, gross under the limit at every close | A spread is a view on a relationship; Brent-WTI is a pipeline and a ship; The crack is a refinery's margin |
| 4 | Information | 19 | Brent | at most 30 lots into every release and the meeting, VaR inside the limit, correct debrief | Expected versus actual; Positioning is a crowd; A rumour has a base rate |

Tier 1 knobs: calm regime (20% vol), timely wire news, deep liquidity, capital $5m and a $20m line (stylised), three
lives, mentor on every new thing.

## Scenarios and traps

* **Level 1**: stocks are drawing and the desk's model sits above the screen (a designed drift); on day 3 an unsourced
  report drops the prompt 2.5% and is denied the next morning. A book sized to the line is called and liquidated at
  that close; a book sized to the VaR limit rides it out.
* **Level 2**: high stocks and contango for 28 days (roll on 29 January costs), then a field outage and a cold snap
  flip the curve to backwardation (roll on 26 February pays). The debrief asks which structure paid the long.
* **Level 3**: a Cushing build on day 4 widens Brent-WTI; turnaround season on day 9 strengthens the crack for ten
  days. The flat price goes nowhere by design.
* **Level 4**: three Wednesday prints, a Friday positioning report that shows a crowded long, a Monday liquidation,
  an OPEC+ meeting with a leak that is forced false and resolved on screen, a hold decision that unwinds the leak's pop.

## Solution bots

`solve(state)` per level. Level 0 buys a lot, answers the drills, sells, ends. Level 1 probes with ten lots, reads the
VaR, scales to 75% of the limit, takes profit at $100k. Level 2 buys forty lots and rolls two sessions before each
expiry. Level 3 buys the Brent-WTI package into the build and the 3-2-1 into the turnaround and closes a week later.
Level 4 is flat into every print and the meeting, shorts the crowded long on the Monday morning, covers after the
unwind, and holds a modest long otherwise. Pass rates over 40 random seeds: 100%, 88%, 100%, 100%, 100%.

## Tier 2: the cargo and the hedge (milestone 2)

| Level | Title | Days | Instruments | Pass rule | Cards |
|---|---|---|---|---|---|
| 5 | First cargo, unhedged on purpose | 30 | Brent (not tradable) | deliver, no demurrage, correct debrief | FOB, CIF, DES; Laycan and B/L; A pricing window is an exposure |
| 6 | The hedge | 35 | Brent | hedge ratio within 10% of one at every close with exposure, flat leg inside $250k, delivered | Lots from barrels; Hedge the window, not the cargo; The gap between hedge and cargo is basis |
| 7 | Basis and quality | 45 | Brent, Dubai swap | sold East on Dubai, delivered, claim handled, East-West hedged or explained | Basis risk; Why Dubai; EFP: paper for the cargo |
| 8 | The hidden time spread | 45 | Brent | delivered, calendar-spread package of half the cargo, correct debrief | Window mismatch is a spread; Backwardation taxes the long cargo; Deemed B/L |
| 9 | Freight and chokepoints | 45 | Brent | delivered, the cheaper passage within 10%, demurrage under a day | Freight is a share of the barrel; A chokepoint is a time spread and a freight shock at once; Storage on water |

Tier 2 knobs: normal regime (30% vol), capital $20m and a $150m line (stylised), first events (a headline move, a port queue,
a differential shock, a quality claim, a restricted Red Sea), three lives.

### Scenarios and traps

* **Level 5**: one Aframax of Forties FOB Sullom Voe, sold CIF Rotterdam; Rotterdam's berths queue on day 7 (hold at anchor
  or slow down, or pay demurrage); Brent drops 5% on day 11 with the cargo unpriced. Par is whatever the unhedged cargo did on
  that seed, so the score compares the player to the same luck.
* **Level 6**: the same cargo with futures; the front contract expires on day 16, mid-voyage: a hedge placed there is
  cash-settled and gone (the mentor says so when it happens).
* **Level 7**: Bonny Light cheap from an independent that needs cash; the differential weakens 80 cents on day 8 (sell before
  it does); a bid from Asia on Dubai for Jamnagar; the inspector finds sulphur off-spec at discharge.
* **Level 8**: a Suezmax of Arab Light priced on the March average against a sale five days after an early-April discharge in
  a backwardated curve; a North Sea outage on day 14 steepens it. The mark is negative the moment the offer is accepted.
* **Level 9**: a Suezmax from Ras Tanura via Suez; the Red Sea is restricted on day 9 and the ship is held at Bab el-Mandeb on
  about day 11 with both costs on the callout; the passage reopens on day 30; contango makes a late barrel worth more.

### Pars and pass rates

| Level | Par on seed 1 (the bot's P&L) | Bot pass rate over 20 random seeds | Checked-in seeds |
|---|---|---|---|
| 5 | -$2,357,058 (unhedged: the cargo's luck on that seed) | 100% | 1 to 10 |
| 6 | -$242,889 | 100% | 1 to 10 |
| 7 | -$897,451 | 100% | 1 to 10 |
| 8 | -$1,088,469 (the mismatch's bill, locked by the spread) | 100% | 1 to 10 |
| 9 | -$1,025,136 (war risk, convoy hire, a wide spread crossed) | 100% | 1 to 10 |

Tier 2 pars were re-recorded in milestone 3 when the fair differential started pricing freight on the cargo's own size. Tier 2 pars are negative: the levels are about delivering and hedging correctly, not about the margin on one cargo, and the
score compares the player to the bot on the same seed (1 + (P&L - par) / max(|par|, $10k), clamped). A player who hedges
as well as the bot scores the full P&L component; one who does better scores more.

### Solution bots

Level 5 accepts, fixes the cheapest fitting ship, sells, and anchors for the queue. Level 6 does the same and keeps
Brent futures in the second month equal to the net unpriced barrels, in chunks of 250 lots. Level 7 hedges the unpriced
purchase with Brent and the unpriced Dubai sale with the swap, fixes the sale by EFP after its first print, settles the claim.
Level 8 buys the calendar spread (front against second) for the whole cargo in 250-lot chunks and hedges the flat price in
the second month. Level 9 compares transit against detour including what the curve pays for the extra days, and anchors for
any berth queue.

## Tier 3: money, counterparties, limits (milestone 3)

| Level | Title | Days | Instruments | Pass rule | Cards |
|---|---|---|---|---|---|
| 10 | Working capital | 42 | Brent, Dubai swap | cash never negative at a close, finance leg inside $2.5m, one cargo declined with a reason | Cost of carry includes money; A letter of credit is a promise and a fee; Prepayment is a loan |
| 11 | Counterparties | 45 | Brent, Dubai swap | inside the concentration limit (2x capital per name) at every close, a dispute settled, a cargo delivered | Cheapest for a reason; Concentration; Due diligence is a position |
| 12 | The risk manager | 30 | Brent, WTI, Dubai swap | inside every limit at every close, P&L at least $200k, at most one life lost | VaR is a quantile, not a maximum; Gross versus net; Reduce before you are told |
| 13 | Storage and carry | 60 | Brent, WTI | carry locked and unwound after the flip, profitable, storage leg inside $450k | Cash and carry; Storage economics; Blending to a spec |

Tier 3 knobs: normal regime, capital $50m and a $400m line, headlines 12 hours behind the market for the delayable events, the
first rumours, three lives.

### Scenarios and traps

* **Level 10**: three cargoes at once (two VLCCs needing letters of credit, a Suezmax with a prepayment discount); the line carries
  two. Rates rise 50 bp on day 12.
* **Level 11**: Stellar at fair, Vantage well under fair (defaults on day 7), Meridian in between (disappears on day 3); Rhine bids
  at fair and Adriatic Smallworks above it (downgraded on day 2, pays twelve days late); the inspector claims sulphur at discharge.
* **Level 12**: a Suezmax of Arab Light seventy cents under fair, sold a dime over; tight limits; a seizure off Hormuz doubles vol
  on day 8.
* **Level 13**: Cushing full and the WTI curve in super-contango; a 500,000 bbl batch in tank, a sour parcel on offer for a blend,
  a rumour on day 20, the hub's lines reverse on day 35 and the curve flips; prompt bids follow on days 36 and 44.

### Pars and pass rates

| Level | Par on seed 1 | Bot pass rate over 20 random seeds | Checked-in seeds |
|---|---|---|---|
| 10 | -$1,668,812 (LC fees, interest on two financed cargoes, hedges) | 100% | 1 to 10 |
| 11 | $460,114 | 100% | 1 to 10 |
| 12 | $417,632 | 75% (the P&L target: basis moves between the purchase and sale windows are unhedgeable with futures) | 1 to 4, 6 to 10, 12 |
| 13 | $52,562 | 100% | 1 to 10 |

### Solution bots

Level 10 takes the Arab Light with a letter of credit and the Bonny with the prepayment, declines the Basrah with the line
arithmetic as the reason, sells and hedges both. Level 11 buys Stellar's cargo, sells it to Rhine (not the high bidder who pays
late), buys Vantage's cheap cargo and insures it, declines Meridian and Adriatic with reasons, settles the claim. Level 12 buys,
sells and hedges in 120-lot chunks and stays inside the limits through the scare. Level 13 leases a tank, takes the batch, shorts
the deferred month against the net exposure, sells into the prompt bid after the flip, lets the hedge unwind as the sale prices,
and gives the tank back.

## Tier 4: products, gas, options, signals (milestone 4)

| Level | Title | Days | Instruments | Pass rule | Cards |
|---|---|---|---|---|---|
| 14 | The refinery | 45 | WTI, RBOB, ULSD, Brent | margin within 5% of par, crack hedge within 25% of the next 30 days of runs at 80% of closes, the better slate 70% of days, VaR inside at every close | Yields; Seasonality of cracks; A turnaround is a supply event |
| 15 | Gas and LNG | 50 | HH, TTF, JKM | an LNG cargo delivered and sold, purchase hedged on Henry Hub and sale hedged on its hub in its own units at 75% of closes, profitable, VaR inside | MMBtu, MWh, m3; Netback; Storage is the gas curve |
| 16 | Options | 45 | Brent, WTI | puts and a collar on the cargo, the programme delta-hedged within 60 lots at 75% of closes, never more than 200 naked short lots at a close, delta, vega and theta on the waterfall | Black-76 in one screen; Delta is a hedge ratio that moves; Vol is a price |
| 17 | Signals | 45 | Brent, WTI, Dubai, ULSD, TTF | the feed bought, two signals traded before their headlines, flat of signal positions at the end, profitable, VaR inside | Lags; Signal versus noise; What a transit count can and cannot tell you |

Tier 4 knobs: normal regime, capital $50m and a $400m line, headlines 24 hours behind the market (36 on level 17), rumours,
back months at half depth, three lives.

### Scenarios and traps

* **Level 14**: a 100 kb/d plant on WTI Midland into driving season; an OSP cut on day 0 makes Arab Light the cheaper slate for
  about a week (and again on day 20); a five-day turnaround on day 7 halves the plant; a Gulf Coast maintenance season firms the
  cracks on day 12; a hurricane shuts the plant for five days on day 24 while cracks jump; a rumour on day 33 about the OSP.
* **Level 15**: a full cargo FOB Sabine Pass at Henry Hub plus the fee; Northgas bids DES Gate on TTF and Sakura Power DES
  Sodegaura on JKM on day 2; LNG hire jumps on day 4 (after the bot has fixed); a late cold snap on day 15; a Freeport rumour on
  day 26; Norwegian flows surge on day 35 while the sale is pricing; a weekly storage release every Thursday.
* **Level 16**: a Forties cargo bought on day 0 and sold on day 1, long 600,000 barrels once the purchase prices; Delta
  Independent buys 300 Brent puts from the desk on day 24; a missile strike doubles implied vol on day 31.
* **Level 17**: a tanker cluster off Fujairah before unsold Gulf crude softens the prompt (day 8), Hormuz transits falling before
  an escort regime (day 14), a hotspot over Jamnagar two ticks before a fire (day 22), the cold forecast before an early cold
  snap (day 30); three rumours (an OPEC+ emergency cut, convoys suspended, Jamnagar back early), each half likely.

### Pars and pass rates

| Level | Par on seed 1 | Bot pass rate over 12 random seeds | Checked-in seeds |
|---|---|---|---|
| 14 | $14,605,403 (the plant's margin less what the crack hedge gave back as cracks rose into the season) | 100% | 1 to 10 |
| 15 | $4,310,936 (the Sodegaura netback less freight, regas, boil-off and hedging friction) | 83% (the arb is negative on some seeds; the right play there is to decline the cargo) | 1 to 7, 9, 11, 12 |
| 16 | -$1,920,210 (the collar's spread, slippage and theta; the programme's vega and gamma through the spike, less theta) | 100% | 1 to 10 |
| 17 | $159,557 (two signal trades, less the feed) | 92% (a true rumour moved the market against a signal position) | 1 to 6, 8 to 11 |

### Solution bots

Level 14 picks the slate with the higher margin per barrel once a day before the run, and keeps the next thirty days of runs
sold forward in 3-2-1 packages of up to 40 units a tick, buying units back as the plant's expected runs fall (turnaround,
hurricane) and as each day's barrels are made. Level 15 accepts the FOB offer, fixes the cheapest LNG carrier, nets back both
bids to the jetty (hire times days plus boil-off over the cargo's MMBtu) and sells to the better one, books a regas slot, hedges
the purchase on Henry Hub and the sale on its hub in its own units, and before the sale hedges the unsold cargo on the hub it
means to sell into. Level 16 buys puts a strike under the forward in 40-lot chunks as the cargo goes long, sells calls two
strikes over against them, trims both as the sale prices, and after the programme sells futures to the larger of the puts'
delta and the lots the naked rule needs. Level 17 buys the feed, enters a signal's contract in its direction when two
consecutive readings are off the baseline (one for the hotspot feed), tags the order "signal", and closes each lot three days
after the headline.

## Tier 5: mastery (milestone 5)

| Level | Title | Days | Instruments | Pass rule | Cards |
|---|---|---|---|---|---|
| 18 | Crises | 75 | WTI, Brent, Dubai, TTF, RBOB, ULSD | four crises survived, no life lost, no forced reduction, drawdown under $15m, VaR inside at 90% of closes | A squeeze into expiry; Liquidity is a regime |
| 19 | The quarter | 90 | everything | P&L at least $1m (or the solution bot's own result on the seed when the bot fell short), VaR inside at every close, no forced reduction, no margin call, no life lost | none unless asked |
| 20 | Partner | until ended (365-day ceiling) | everything | profitable when ended, no forced reduction, no life lost | none unless asked |

Tier 5 knobs: the mentor silent (the ask box still answers), the wire 36 to 48 hours behind the world, rumours, back months at
half depth, three lives. Partner adds depth halved in stress, counterparties that price the player's known positions against
them, a fresh seed every run and a leaderboard against the player's own past runs. Sandbox mode (any level, any seed, any knob,
no score) is on the Academy.

### Scenarios and traps

* **Level 18**: an inherited book (300 WTI front-month lots long, 400 TTF lots short with nothing behind them, a VLCC of Arab
  Light bought FOB Ras Tanura and sold DES Ningbo on Dubai, a 100 kb/d plant with no crack hedge) through a squeeze of the WTI
  front month into expiry (it settles about -$30), a European gas spike in week three (TTF up by half, then a quarter more, then a
  third back), Hormuz closed for ten days with the ship inside the Gulf (it holds and sails on at the reopening), and a hurricane
  that shuts the plant for five days in week eight; two rumours.
* **Level 19**: twelve offers and bids over ninety days from every name met before: cheap Forties, Bonny and Arab Light with buyers
  a week or two behind; a Vantage offer with a month-average window a month after loading (a hidden time spread); the refiner that
  pays late with the best bid on the screen; Vantage again with Urals through the Bosphorus; two cargoes that need a letter of
  credit; a prepayment discount; an OPEC meeting, a rate move, the Red Sea restricted for twelve days, a quality claim, a berth
  queue at Rotterdam, three rumours.
* **Level 20**: the same kind of flow repeating every thirty days with the names rotating, a scare in the Gulf mid-month that fades
  and a rumour late in it, every bid for a grade the player holds twenty cents cheaper and every offer to a long book fifteen cents
  dearer.

### Pars and pass rates

| Level | Par on seed 1 | Bot pass rate over random seeds | Checked-in seeds |
|---|---|---|---|
| 18 | $18,926,819 (the plant's margin, the cargo's edge, the inherited long rolled out of the squeeze) | 100% (8 of 8) | 1 to 10 |
| 19 | $2,144,983 | the $1m budget is reached on 11 of 20 random seeds; the bot's own result on the seed passes it on the rest (the pass rule says so) | 1 to 5, 7, 8, 10 to 12 |
| 20 | $1,505,446 (a choosier policy: edge 0.4 and two cargoes at once) | 83% (10 of 12) | 1, 3, 5 to 12 |

A quarter's P&L has a standard deviation of about $1.5m across seeds from the legs futures cannot hedge (Dated against futures
and Brent against Dubai during the windows, the curve between a purchase window and a sale window), which is why the quarter's
pass rule falls back to the solution bot's own result on the player's seed when the bot itself missed the budget; the score was
always relative to that par. Partner's pass is profit, and its leaderboard is the player's own past runs.

### Solution bots

Level 18 closes the naked gas hedge on day one, rolls the front-month long to the third month before the squeeze, hedges the
cargo on Dubai in the second month and rolls that hedge when the closure pushes the window past its expiry, and keeps the next
thirty days of runs sold in 3-2-1 packages, lifting the units the hurricane will not run. Levels 19 and 20 run the generic policy
described in `docs/DESIGN.md`: take the cheap offers that pay for the carry to their window from names that pay, counter the
near ones once, decline the traps with a reason, sell into fair bids, fix ships, open letters of credit, settle claims, hedge every
basis in its own contract in 200-lot chunks and roll hedges before they expire. Partner's bot ends its run on day 90.

## Not yet

Nothing: all twenty-one levels are built. The milestone 5 ledger of what was left out is in `docs/DESIGN.md`.
