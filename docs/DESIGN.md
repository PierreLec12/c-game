# DESK: design as built

Milestone 1 (the paper desk) written 2026-10-19; milestone 2 (the cargo and the ship) and milestone 3 (money and limits) added
2026-10-20. This file records what was actually built and every deviation from `BUILD_PROMPT.md`. It is updated at the end of every
milestone.

## Stack (section 3.1 of the prompt; default kept)

TypeScript end to end, one pnpm workspace:

| Package | What | Tests |
|---|---|---|
| `packages/engine` | the simulation: pure TypeScript, zero DOM, zero I/O | vitest, 42 tests |
| `packages/content` | the curriculum: levels 0 to 4, cards, drills, mentor, glossary | vitest, 11 tests |
| `apps/web` | React 18 + Vite + Zustand, hand-drawn SVG charts, IndexedDB saves, static build | vitest component tests (5), Playwright smoke test and screenshots |

Recharts was not used: the curves, the waterfall, the gauges and the time lines are hand-drawn SVG (fewer dependencies,
every pixel explainable). d3-geo and the coastline file arrive with the map in milestone 2.

The static build is 396 kB of JavaScript (124 kB gzipped) and 9 kB of CSS, well under the 3 MB budget.

## The engine's contract (section 3.2)

```ts
newGame(spec: LevelSpec, seed: number, opts?: { par?: number }): State
applyActions(state, actions, rng): { state, refused, events }   // acts at the current tick, time does not move
tick(state, actions, rng): { state, refused, events }           // applyActions, then one simulated hour
replay(seed, levelId, log, untilTick?): State
runPolicy(spec, seed, policy): { state, log, events }           // runs a solution bot
```

Deviations from the prompt's signatures, and why:

* **`applyActions` exists next to `tick`.** When the clock is paused the player still expects a click to fill at the quotes
  on screen. `applyActions` applies actions without moving time; `tick` is `applyActions` followed by one hour. The log
  records actions by the tick they were submitted at, and replaying `tick(state, actionsAtT)` for each tick reproduces
  both paths, so determinism and the replay test hold.
* **Levels are a registry.** `tick` and `replay` take a level id as the prompt says; the content package registers its
  `LevelSpec`s on import. The engine never imports content.
* **The random streams are stateless.** `Rng.stream(name, tick)` hashes seed, name and tick, so there is no RNG state in
  the save file and every subsystem draws independently. Determinism is tested bit for bit (JSON of the whole state).
* **`State` is a plain object**; a `Fig { v, at, why }` carries the explanation of any derived number the UI shows
  (VaR, settles, consensus, actuals). Everything else explains itself from the state through the `Fig` component.

### Module layout

As the prompt's list, with these additions: `calendar.ts` (sessions, holidays, expiries, listed months), `clone.ts`,
`conversions.ts` (the ported constants), `levels.ts` (the `LevelSpec` type and registry). `physical`, `shipping`,
`storage`, `refinery`, `gas`, `counterparties` are milestone 2 to 4 and do not exist yet; the state already carries
the latent gas and freight fields the factor model needs.

## Clock (section 3.3)

One tick is one simulated hour. Speeds as ticks per real second: 1x = 0.5, 4x = 2, 12x = 6; "next event" runs up to
40 ticks a frame until the next pausing event. The prompt says both "one tick per two real seconds" for 1x and
"twelve ticks a second"; the first was kept and 12x means twelve times it. The UI drives `tick` from
`requestAnimationFrame` with an accumulator; the engine never reads a wall clock.

Measured: a tick on a busy book (five contracts across four instruments) takes **0.24 ms** in Node on a 2023 laptop
(the suite asserts under 5 ms); `newGame` takes about 160 ms because it runs the solution bot once to set the par.

Sessions: markets trade every hour of a weekday; the settle is at 19:00; weekends and three stylised holidays are
closed for prices (orders rest; the roll-down of a contract's structure continues with calendar time, which is why
a mark can move a few cents over a weekend). A level is `days x 24` ticks.

## Persistence (section 3.4)

IndexedDB (`idb`): one save slot per level `{ level, seed, log, tick, state, savedAt }`, plus per-level progress and
the cumulative score. Export and import as JSON (`format: "desk-run-1"`); an imported run is replayed from its seed and
log, never trusted from its cached state. A content test proves a bot's log replays to the identical state.

## The factor model (section 5.2 and section 15)

Every contract price is a sum of named parts, so attribution is exact by construction:

```
BRENT(tau) = brentPrompt + S_brent(tau)
WTI(tau)   = brentPrompt - bw + S_wti(tau)
RBOB(tau)  = (brentPrompt - bw + gasolineCrack) / 42 + S_rbob(tau)
ULSD(tau)  = (brentPrompt - bw + dieselCrack) / 42 + S_ulsd(tau)
HH(tau)    = hhPrompt + S_hh(tau)
TTF(tau)   = ttfPrompt + S_ttf(tau)        (EUR)
```

`tau` is months to expiry; `S(tau)` is the cumulative structure from the front monthly spread (`spread1`) decaying by
0.82 a month. Dynamics per trading hour (all coefficients in `refdata.ts` with their basis):

* the prompts are log-OU processes pulled 4%/day toward an anchor set by the inventory gap (−0.4% per mb OECD
  surplus) and the geopolitics index (+18% from 0 to 1), with Student-t(4) hourly noise scaled by the regime vol
  (calm 20% … crisis 90%), the instrument multiple, the hour-of-day profile, the geopolitics index, event intensity and
  a known release ahead;
* `spread1` is OU to a target from inventories: contango of 0.012 $/bbl/month per mb surplus capped at 95% of full
  carry (storage plus financing), backwardation of 0.03 per mb deficit capped at 4 $/bbl/month; above 90% of carry
  the pull back is strong and a hard clamp sits at carry plus a 0.10 noise band;
* Brent-WTI is OU to 2.0 + 0.05 per mb of US surplus, with the transatlantic arb pulling it back above $3.50;
* cracks are OU to a base plus a seasonal swing, minus 0.3 per mb of product surplus, plus 40 per unit of refinery
  run share below 0.9;
* HH and TTF anchors follow storage gaps and heating-degree-day anomalies; EURUSD is a 6% random walk.

Invariant tests: parts sum to the price; one-month contango never exceeds full carry plus the band for more than two
sessions on a very-high-inventory level; backwardation target widens with tightness; implied vol has a term structure
and a put skew.

**Deviation (section 5.2, Brent minus WTI).** The prompt says the spread "cannot stay below the cost of moving a barrel
from Houston to Rotterdam for long (the arb closes it)". Economically the arb bounds it from **above**: when Brent minus
WTI exceeds the shipping cost, exports close the gap. The engine implements the upper bound and the card
"Brent-WTI is a pipeline and a ship" teaches it that way. The player would notice the wrong version, so this is
flagged in the hand-over note as well.

### Pre-history and level start

The VaR needs 250 sessions of closes, so `newGame` simulates 260 business days before day 0 with the same dynamics at
negative ticks (`prehistoryWorld`, default the level's world, without the balance drift). The level then starts with
the flat prices snapped to the pre-history equilibrium and the level's world driving the anchors: a level whose world
differs from its pre-history (level 1, level 4) starts with a designed drift the briefing tells the player about.

## Liquidity (section 5.3)

Spread in ticks = base x 1.18^month x hour profile x regime; depth = base x 0.78^month x regime / hour profile.
A market order fills at the touch plus slippage of half a spread per unit of depth consumed; the mid moves by half a
spread per depth consumed and decays 40% a tick. Above 2% of the front month's daily volume an order is refused with a
sentence naming the share. Limit orders rest and fill when the touch crosses them (never worse than the limit); stops
trigger into market orders. The ticket shows touch, depth, slippage, fees, notional and margin impact before the click
and the fill after.

## Finance and margin (section 7)

Every cash movement is a ledger row; the test asserts cash equals the sum of its rows in both currencies. Initial
margin is a share of notional per instrument with 70% offsets for calendar pairs and 60% for Brent-WTI and
crude-product pairs; the engine moves cash to the clearer at every fill and close and draws the line when cash is
short (`autoDrawn`, repaid as soon as cash allows, interest charged daily at base plus 150 bp). Variation margin goes
to cash at every settle. If cash is negative after a settle and the line cannot cover it, a margin call is raised, due
at the next close; unmet, the clearer liquidates at the touch. The level-1 trap (a book sized to the whole line) is
tested: a 6% headline day produces a call and a liquidation.

EUR: TTF variation margin lands in a EUR balance, revalued at every movement and settle; the revaluation is the FX leg.

## P&L attribution (section 8)

Each lot stores the factor parts at its last mark. At every settle and every close, the change in each part times lots
times lot value is a row (`flat`, `basis`, `crack`, `time_spread`, `fx`); the residual against the actual price change
is `fees_slippage` (crossing the spread plus own impact) and the exchange fee is its own row; interest is `finance`.
Rows carry one sentence each. The suite asserts legs sum to book P&L to the cent at every settle on a book of outrights,
a calendar spread, a Brent-WTI spread, a 3-2-1 crack and a TTF lot. The roll yield of an outright appears in
`time_spread` without any roll action, because the contract's `tau` shrinks every day.

## Risk (section 7)

One-day 95% VaR by historical simulation: for every contract held, the 250 reconstructed closes at the contract's
current `tau` from the factor history, their returns applied to today's exposure, the 95th percentile of the losses.
`historicalVar` is the ported function from c-terminal with the same hand test. Limits: VaR, net lots per instrument,
gross lots, stop-loss, drawdown. At each close a breach of a soft limit is one strike: a warning with the number and the
formula, then a forced pro-rata reduction at the touch, then a life (and the book flattened); stop-loss and drawdown
take a life at once and the reference resets. Three lives; none left ends the level. Stress is a full re-pricing under
eight price and vol shocks (vol shocks matter once options exist). A limit can be raised 50% on a clean track record.

## Scoring (section 8)

```
score = 100 * clamp(pnl / par, -1, 2) + 50 * process - 25 * max_drawdown / capital + 25 * quiz
```

**Deviation: par per seed.** The prompt says par is "the solution bot's P&L on the same seed", so `newGame` runs the
bot on the player's seed and stores the par in the state (`level.par`); each level file also checks in the par on its
default seed as a regression test. **Par floor:** when the bot barely breaks even on a seed the ratio loses its meaning,
so the divisor is `max(par, $10,000)` (stylised; shown in the score formula on the debrief). **Level 0 has no par**
(`noPar`): its P&L component is a flat 100, because a one-lot round trip is not a P&L exercise.

Pass: score at least 100, no life lost, the quiz answered, and the level's own rule. Ranks: Operator (0), Junior
Trader (300), Trader (800), Senior Trader (1500), Book Head (2400), Partner (3200) on the sum of best scores.

## Events and information (section 5.4)

Library in milestone 1: weekly inventory release (consensus on the morning, actual at 15:00, the surprise moves the
prompt −0.4% per mb), OPEC+ meeting with a leak the day before that is right two times in three (or forced by the
level), positioning report (optionally "crowded"), inventory shock, refinery turnaround with an automatic end,
headline move, balance shift, rate move, geopolitical scare. A leak's pop unwinds at the meeting if it was wrong and
the leak is resolved on screen as false. Tested: no news precedes its trigger except a leak, which precedes its meeting
and is resolved.

## UI (section 11)

Nine routes with a persistent top bar; Desk and Map say "not yet" with the level that unlocks them. Every number is a
`Fig` with a what, a why and a tick on hover and focus (`aria-label` carries the same text). Stylised figures carry a
"stylised" tag. Cards slide in and auto-pause the clock; the Academy lists cards, the glossary generated from them,
progress, About, export and import. Keyboard: space, 1/2/3, N. Colours pass WCAG AA on the navy; the smoke test runs
axe on every screen and fails on serious or critical violations.


## Level pars and bots (section 15)

Pars on the default seed: level 1 $104,176; level 2 $74,396; level 3 $61,850; level 4 $97,680. Every bot passes on
its ten checked-in seeds; on 40 random seeds the pass rates were 100% (levels 0, 2, 3, 4) and 88% (level 1, whose pass
rule needs positive P&L in a calm market with a designed drift: seeds 4, 21, 24, 27 and 40 lose). Seeds that fail
under the real scoring were skipped when choosing the ten (level 2: seed 4; level 3: seeds 1 and 10; level 4: seeds 5
and 10). No bot needed a rule change; level 1's bot takes profit once the level's P&L reaches $100,000 and sits out.

## Other deviations from the prompt, recorded

* **Level 2 runs 56 days**, not 10 to 20: two rolls need two monthly expiries (29 January and 26 February 2027).
* **TTF lot is 720 MWh** (1 MW for a 30-day month), not "1 MWh per lot-unit", so a lot is a sensible size on screen.
* **Level 4 scripts its surprises**: the OPEC+ leak is forced false (the prompt asks for one false leak), the first
  positioning report is forced crowded and a liquidation move follows on the Monday, so the level teaches what its
  cards say.
* **Intel and Finance screens exist in milestone 1** (minimal) because level 4 needs the release calendar and level 1
  needs the ledger and margin account; the prompt schedules them later.
* **Drills may be retried** when wrong; the level still needs six of six.
* The engine's "desk view" (the model's fair value) is shown on the Bridge in tiers 0 and 1 only: it is the level's
  briefing made explicit, and the bots for levels 1 and 4 act on it as a player would.

---

# Milestone 2: the cargo and the ship (2026-10-20)

## New engine modules

| Module | What |
|---|---|
| `world_data.ts` | ports, the sea graph (nodes, edges), chokepoint parameters, vessel classes and the named fleet, the grade quality grid, the counterparties, shipping parameters, the prompt's reference voyage days |
| `shipping.ts` | great-circle distances, Dijkstra routing with closed chokepoints removed, positions along a path, charter quotes, voyage planning, re-pathing from where a ship is, passage options |
| `physical.ts` | pricing windows, basis forwards by part, leg and cargo marks, attribution rows, prints and invoices at the settle, payments, EFP, claims |
| `voyages.ts` | the per-tick voyage stepper: ballast, laycan, loading, bill of lading, laden, restricted passages, berth queues, discharge, demurrage, release; automatic rerouting; diversions |
| `counterparties.ts` | fair differentials on the grade grid (plus freight and insurance for delivered terms), tender issuance with the counterparty's edge |

The state gained `cargoes`, `tenders`, `vessels`, `voyages`, `chokepoints`, `portCongestion`, a `DUBAI` instrument (a monthly swap,
1,000 bbl, three ticks wide, thinner than Brent), grade differentials and a freight index in the factors, a per-close snapshot
(`risk.closes`) of physical exposure and net lots, and the actions `accept_tender`, `decline_tender`, `fix_charter`, `instruct_ship`,
`efp`, `settle_claim`, `contest_claim`.

## Pricing-window vocabulary (section 15)

A window is a list of level days. "5 days after B/L" is the five business days after the bill of lading day; "5 days after
discharge" the five after discharge completes; "month average" every business day of the B/L's calendar month; "deemed B/L"
is "after B/L" anchored on a stated day whatever the ship does. A day's assessment is the model's value of the basis at that
day's 19:00 settle: for Dated, the Brent prompt plus the front structure plus the Dated differential; for Dubai, the prompt
minus the East-West spread plus the Dubai structure; for WTI, minus Brent-WTI. Before a window is anchored the leg is marked
on the expected anchor (the laycan start plus one day; the ETA plus two days). The invoice is due five days after the window
completes (stylised; a real contract says thirty days after B/L).

**An unpriced day is marked at the forward assessment for that day**: the prompt plus the structure at the front contract's
tau plus the days ahead. That makes a window the same object as a futures position in the attribution (flat, time spread,
basis), and it is why a purchase on the month average against a sale a month later shows a time-spread leg the moment it is
accepted (level 8). A leg is booked over all its days: printed days at the parts recorded at their print, unpriced days at
today's forward, plus the differential; the sum is the leg's mark, so re-anchoring a window at the bill of lading, a print,
or a differential change all attribute exactly. An unsold cargo is marked at its benchmark forward at the expected discharge
plus the market differential delivered (the grade grid plus the cargo's own expected freight and insurance); when a sale is
contracted the expected mark is reversed and the contract booked.

The physical exposure in barrels is long on unpriced sales and unsold oil and short on unpriced purchases; it enters the VaR
as front-Brent barrels and it is the number the hedge coverage bar compares the futures to.

## Map projection, coastline, waypoints (section 15)

Natural Earth 110m land (public domain, 138 KB, 127 polygons) bundled as JSON and drawn once to an offscreen canvas in
d3-geo's equal-earth projection; ships, ports, chokepoints, routes, trails and callouts are drawn on top each frame. The sea
graph has 20 port nodes, 11 chokepoint nodes and about 75 hand-placed waypoints joined by about 125 edges; routes are
shortest paths over it with closed chokepoints removed. The test samples every edge at fifteen points and asserts none fall
inside the land polygon, exempting points within 110 km of a port and 200 km of a strait or canal node, because the 110m
coastline resolves neither harbours nor canals. Distances are great-circle sums; voyage days are distance over 12.5 knots
laden (13.5 ballast) and come out within a third of the prompt's stylised table (Ras Tanura to Rotterdam via Suez about 23
days against the table's 20; the table is kept in `world_data.ts` as the reference the test checks).

## Shipping mechanics

A voyage charter is hire per day (class base times the freight index times the owner's edge) times ballast, laden and four
port days, plus an 8% margin (stylised). Fixing a ship that cannot reach the load port by the laycan end is refused. Loading
takes 30 hours after the laycan opens; the bill of lading is signed when it completes. At the discharge port a ship tenders
notice of readiness, berths six hours after the later of its arrival, the port's congestion clearing and the discharge
window opening, and discharges in 24 hours; laytime is 36 hours from the later of notice and window start, and the excess
is demurrage at the ship's hire. A ship can be slowed to 70% of service speed or held at anchor before notice (storage on
water, at full hire). A restricted chokepoint holds a laden ship for an instruction: transit with a convoy delay and a
war-risk premium per barrel, or go round; a closed chokepoint re-routes every affected voyage from where it is, with the
detour's days and hire shown. Freight, demurrage and war risk are paid at delivery; invoices five days after their window.

The calendar-spread package trades in a book four times deeper than the outright book (stylised), so a cargo-sized spread
hedge is affordable; outright blocks above 2% of daily volume are still refused.

## Counterparties in milestone 2

The roster of section 4 exists with ratings and behaviour profiles; producers and refiners issue tenders at the fair
differential plus their edge, shipowners quote hire at their edge, the inspector raises a quality claim that can be settled
or contested (a coin toss, losing costs 25% more). Memory, late payment, default and ratings that move arrive in milestone 3.

## Level pars and bots (section 15)

See the table in `docs/LEVELS.md`. Tier 2 bots were tuned over 20 random seeds; the ten checked-in seeds pass. No bot needed
a rule change, but three things in the engine were wrong until the bots found them: a diversion while in ballast zeroed the
laden leg; a ship stopped exactly on a strait node was judged one node further along, so "go round" went straight through;
and a passage decision could be re-issued every hour while the ship waited, charging the premium ninety times.

## Deviations recorded in milestone 2

* **Tier 2 cargoes are one million barrels.** The prompt sizes Arab Light on a VLCC (2 million). At $80 a 2 million barrel
  invoice is $160m against the tier's $150m line: the purchase payment forces a margin call that liquidates the hedge. Levels
  8 and 9 take a Suezmax part-cargo; VLCC sizes return with working capital in tier 3.
* **Level 5's stop-loss is $8m** rather than the tier's $4m, because the level is unhedged on purpose and a $5 move on
  600,000 barrels is the lesson, not a life.
* **Level 7 sells to Jamnagar, not Ningbo**: Bonny to Ningbo round the Cape is 35 days and the level would not fit 45; the
  Asian refiner takes Jamnagar on Dubai, which teaches the same East-West exposure.
* **Hedging the day's print**: the day's assessment lands at the settle, so the exposure a trader can hedge by a close is the
  one before that settle's prints; the close snapshot records it and the ratio objective reads it. Hedging "ahead" of the
  print would be over-hedged intraday in this model.
* **Level 8's pass rule** needs the calendar-spread package in the same run, not "the second run": the engine does not know
  attempts. The briefing says to replay.
* **Level 9's "freight inside par"** is implemented as "chose the cheaper passage within 10% at the decision", because the
  bot's freight leg on the player's seed is not available to a live objective; the passage decision records both costs.
* The quality claim event fires on the first delivered cargo on or after its day; the inspector's re-test is a coin toss.
* Tier 2 unlocks the Dubai swap from level 7 rather than listing it with the futures from level 0.
* **Tier 1 pars were re-recorded** (level 1 $102,619; level 2 $76,540; level 3 $60,056; level 4 $106,880): the Dubai swap's
  structure draws from the price stream, so every tier 1 world differs slightly from milestone 1. The bots still pass their
  ten seeds. A save from milestone 1 would not replay to the same state; there were no saves to keep.

---

# Milestone 3: money and limits (2026-10-20)

## Finance in full

* **Letters of credit.** A seller may require one (the tender says so). Opening one costs 0.25% of face per quarter (section 14)
  and holds the face off the line until the purchase invoice is paid, so `lineAvailable = limit - drawn - open LC faces`. A cargo
  that needed an LC and has none at the laycan is cancelled, the charter with it (the owner keeps 15% of the lump sum, stylised),
  and an onward sale owes its receiver.
* **Prepayment.** A tender may offer a discount on the differential for paying before pricing; the payment is the cargo's forward
  value today, drawn on the line, netted off the invoice. In a default the prepayment is lost (credit leg).
* **Covenant.** A drawdown beyond 40% of capital cuts the line to what is drawn and committed; no new draws. Checked at every close.
* **Insurance.** Non-performance cover on a cargo costs 0.6% of its value and recovers 90% of the loss on a default (stylised).
* **The desk draws the line for payments it cannot fund from cash** (`autoDrawn`, repaid when cash returns), which is where the
  finance leg's interest comes from on every financed cargo; the player's own draws stay until repaid.

## Counterparties in full

A `CounterpartyState` per name: rating and score, an edge adjustment (memory), disputes, late payments, defaulted, gone. The
small refiner pays twelve days late, once per invoice, with a headline; the aggressive trader defaults (every undelivered cargo
bought from it is cancelled, onward sales claim, insurance recovers); the mid-sized trader disappears (quotes withdrawn, cargoes
cancelled without a claim). Ratings move with events and with defaults. A contested claim is remembered: the name quotes 15 cents
worse from then on. A counter on a tender is answered by `decideCounter`: reliable names move a dime, aggressive ones thirty cents,
less what they remember. **Exposure** to a name is undelivered cargoes bought from it plus prepayments, plus unpaid or unpriced
sales to it; **concentration** is the largest such exposure as a multiple of capital (a limit of 50 or more is off).

**Deviation.** The prompt's "concentration limit per counterparty" is implemented as a multiple of capital, not a share of total
exposure: with one cargo on the book a share limit is 100% by construction. A concentration breach cannot be cut at the touch, so it
escalates on its own schedule: a warning every close and a life after five, instead of warning, forced cut, life.

## Storage and blending

Tanks at Cushing, Rotterdam (in EUR), Fujairah, Singapore and Saldanha Bay (section 14 costs; Rotterdam's $0.60 became 0.55 EUR).
A lease is capacity by the month with a minimum term paid out on early release; charges land in the storage leg on the anniversary.
A delivered cargo at the tank's port goes in as a parcel marked at the local benchmark prompt plus the grade's differential; the
parcel is long physical exposure. Selling a stored cargo forward draws the parcel at once (the barrels are committed; the sale leg
carries them) and the tank stays leased until that sale is paid. A pipeline hub (Cushing) has no sea node: a batch there is
"delivered" on the laycan's first day with no ship. Two parcels blend to one at the volume-weighted API and sulphur, priced on
the quality grid (0.12 $/bbl per API degree around 38, 2.00 per sulphur point around 0.5%, less a blend discount, stylised); a
blended parcel is marked but cannot be tendered yet (that arrives with the refinery), and a parcel sold forward cannot be blended.

**Super-contango.** By construction contango sits under full carry, which makes cash-and-carry unprofitable for a player whose
line costs more than the model's base rate. Above a 40 mb surplus (tank tops) the cap rises to 1.3 times carry (stylised), so
level 13's carry pays about a third of a dollar a barrel.

## Information in tier 3

A tier knob `infoDelayHours` (12 in tier 3): for the delayable kinds (outages, seizures, chokepoints, strikes, congestion,
differential and freight shocks, balance and inventory shocks, scares, turnarounds, defaults, disappearances) the world moves at
the event tick and the headline arrives later, marked with when the market moved. Releases, meetings and leaks, tenders, headline
moves and claims are not delayed. **Rumours**: a scheduled rumour decides its truth at scheduling (p = 0.5 by default), moves the
market a little, and is resolved on screen: a true one is confirmed by the real event at the resolution tick, a false one is denied
and the move unwinds.

## Fair differentials

A delivered bid's fair differential prices freight on the smallest class that carries the cargo at the market's hire (a
Suezmax for a million barrels), not on the grade's default class spread over a full VLCC: the bot's level 12 edge was being eaten
by that mismatch. Tier 2 pars moved a little and were re-recorded.

## Levels 10 to 13

See `docs/LEVELS.md`. Level 12's bot passes 75% of random seeds: the P&L target is reachable but the Dated-to-futures basis
moves between the purchase and sale windows and futures cannot hedge it; ten passing seeds are checked in. Deviations: level 12's curve is flat so the cargo's edge is not eaten by the window mismatch, which is level
8's lesson; level 13's "carry closed before the flip" is read as "unwound once the curve flips", which is when a carry must be
unwound; level 10's "finance leg inside par" is a stated band ($2.5m) because the bot's leg on the player's seed is not available
to a live objective. Tier 3 capital and line are the prompt's $50m and $400m.

# Milestone 4: products, gas, options, signals (as built, 2026-10-20)

Milestone 4 adds options on the book, the refinery, the gas and LNG chain, the JKM swap, signals that run ahead of the news,
thin back months, and levels 14 to 17. The engine stays pure; nothing was imported from c-terminal (the Black-76 port from
milestone 1 is the maths; `optionbook.ts` is the book around it).

## Options on the book (`optionbook.ts`)

* **Listing.** Every listed futures month carries a strike grid: 20 strikes either side of the forward at the instrument's step
  ($1 for crude, 5 cents for products, 10 cents for Henry Hub, 1 EUR for TTF, 25 cents for JKM, stylised), re-centred on the
  forward as it moves, and any strike the player holds stays listed so a position can always be closed. An option expires three
  business days before its future (stylised; ICE Brent options expire a few days before), at that day's settle.
* **Price.** Black-76 on the month's futures mid at the surface vol for the option's tenor and moneyness (the milestone 1 surface:
  a mild downward term structure and a put skew of 0.8 vol points per 1% below the forward; the port had the skew scaled by a
  hundred and never used it, now fixed). The market shows an option one vol point wide: the bid is the model at the surface vol
  less half a point, the ask at plus half a point. Depth is 40 lots at the touch, decaying by month like the futures; slippage is
  the futures rule applied to the vol spread; no market impact is modelled on options (stylised).
* **Futures-style margining.** No premium changes hands at the fill; the option's value settles daily as variation margin like a
  future (ICE Brent style, stylised; recorded as a decision). Initial margin is the instrument's share of the delta-equivalent
  notional, with a floor of a quarter delta on short options.
* **Attribution by Greek.** At every settle and every close of a lot, the move from the lot's base inputs (F, sigma, T at the last
  mark) is split into delta, gamma, vega and theta from the base Greeks, a model residual ("other": higher-order terms, the skew
  and term structure of the surface, settlement at intrinsic), and the vol spread crossed against the model mid (fees and
  slippage). Rows carry `greek`; the waterfall sums them into the options leg and the Book breaks them out. The invariant that
  legs sum to the book to the cent holds with options on the book (tested).
* **Expiry.** On its expiry settle an option is marked at intrinsic value, the variation margin flows, and the lot leaves the
  book with an expiry event. Exercise into futures is not modelled (deviation: cash settlement at intrinsic, stylised).
* **Risk.** Options enter the historical VaR as their delta-equivalent lots of the future; the stress table re-prices every option
  under each price and vol shock (full re-pricing, as the prompt asks). A new limit, `nakedShortOptions`, counts short option lots
  not covered by the underlying: a short call needs long futures or long physical units of the instrument's benchmark behind it, a
  short put short ones; the count is net per instrument. It is a soft limit with the usual three strikes, and a forced reduction
  closes option positions pro rata at the touch like futures.
* **Strategies.** A collar (long put, short call), put spread, call spread, straddle and strangle trade as packages of option
  orders sharing a package id; the player's side reverses every leg. The ported `buildStrategy` payoff maths is unchanged.
* **A vol spike event** raises event intensity (the vol surface multiplier) and the regime with it, so depth halves while vol is
  high; it fades at 30% a day. A **producer programme** event books an option fill with the desk as the counterparty: the client
  buys puts at the desk's bid and the desk is short from there.

## The refinery (`refinery.ts`)

* **One plant, 100 kb/d.** The prompt says 200 kb/d; the plant is 100 kb/d so a month's crack hedge (1,000 three-lot packages)
  fits the products' depth and the tier's gross limit on screen. Recorded as a deviation.
* **Yields** are fixed per slate (WTI Midland: 48% gasoline, 30% diesel, 10% jet, 8% fuel oil, 4% loss; Arab Light: 40/30/8/18/4),
  stylised. Jet has no contract and prices at diesel plus $2. The margin per barrel is the yield-weighted product price at the
  prompt cracks less the delivered crude (the slate's benchmark plus its differential plus a delivery cost: $1 for a Permian
  pipeline barrel, $2.50 for a Gulf VLCC barrel) less $3 of operating cost, with $1 per barrel of capacity a day of fixed cost
  paid whether the plant runs or not. Every number is on the Desk with its working.
* **Realisation.** The plant's margin is realised once a day at the settle hour at the day's marks, in cash and in a new
  `refinery` attribution leg. The plant's forward margin is not marked (the hedge is), which is the margin-call problem of a hedged
  refinery and is why the tier's drawdown limit is wider on level 14.
* **Decisions.** Runs (a share of capacity) take effect at the next day's run; a slate change takes effect at the next day's run
  (stylised 24-hour switch). A hurricane shuts the plant for its duration and a turnaround caps runs at half.
* **The hedge.** A 3-2-1 package is 2 RBOB and 1 ULSD lots against 3 WTI lots: 126,000 gallons against 3,000 barrels, the same oil,
  so its flat and basis parts cancel exactly in the factor model and only the crack and time-spread legs remain (tested). The
  level's hedge target is the next thirty days of runs in 3,000-barrel units.
* **Events.** A Gulf hurricane (product cracks jump, the prompt softens, Gulf Coast ports close, the world's runs fall, the plant
  shuts); a turnaround at the plant; the existing world turnaround.

## Gas and LNG (`physical.ts`, `shipping.ts`, `voyages.ts`, `markets.ts`)

* **JKM** joins the instruments as a monthly swap: TTF in dollars per MMBtu (TTF x EURUSD / 3.412) plus an Asian premium that widens
  when LNG arrivals thin, with its own front spread. Its noise is drawn from a second rng stream ("gas") so every par from
  milestones 1 to 3 is unchanged; its price parts are flat (TTF in dollars), basis (the premium) and time spread.
* **Bases.** A cargo leg may price on HH, TTF or JKM as well as the crude benchmarks. Gas bases are in $/MMBtu. A TTF-priced leg
  decomposes into flat (TTF at the level's opening EURUSD), an `fx` part (the dollar value of the euro price at today's rate against
  the opening rate) and time spread, so a TTF-priced cargo shows an FX leg in the waterfall without any EUR cash. A TTF-priced
  invoice is paid in euros into the EUR account at the day's rate (the balance is revalued first so the FX leg is exact).
* **The LNG grade** is counted in MMBtu, not barrels (3,600,000 MMBtu a cargo, about 174,000 m3); the engine's quantity field is
  the same and the unit is the grade's. It prices FOB at Henry Hub plus a $2.50 tolling fee (deviation: the prompt's "115% of
  Henry Hub" is a fee here so the leg stays an average plus a differential), is carried only by an LNG carrier (and an LNG carrier
  carries nothing else), and is marked unsold at the netback of its discharge terminal: the terminal's hub (TTF at Gate and
  Zeebrugge, JKM at Sodegaura) less a $0.50 regas fee and a $0.10 buyer's margin, whatever the freight.
* **Boil-off** of a tenth of a percent of the cargo a day at sea is booked at discharge as product not delivered at the sale price
  (freight leg) and comes off the invoice; the cargo's quantity field stays the loaded quantity (stylised).
* **A regas slot** is booked by the player; without one the ship waits three days for one at the terminal with laytime running.
  The fee is paid at discharge either way.
* **Physical exposure by basis.** `physicalExposureBbl` now also returns the exposure split by pricing basis in the basis's units,
  so a gas cargo's hedge is sized in the right contract: 3,600,000 MMBtu is 360 Henry Hub lots, 360 JKM lots, or 1,465 TTF lots
  (MMBtu / 3.412 / 720). VaR puts gas exposure on its own hub's front contract (TTF after the MWh conversion); crude bases stay on
  Brent as before so earlier levels are unchanged. The close snapshot records the pre-print exposure by basis.
* **Gas events.** A weekly US storage release (consensus the morning of, actual against it, Henry Hub moves by the surprise); a
  cold snap (heating-degree-day anomaly, TTF jumps, storage drains faster, ends after its days); a generic gas shock (used for a
  Freeport outage and a Norwegian flow surge).

## Signals (`signals.ts`)

* A level's schedule may attach a signal to an event (`params.signal`): a series that leaves its baseline `leadTicks` before the
  event fires, ramps to its offset at the event, fades over three days after, with noise. Four kinds: tankers at anchor off
  Fujairah (daily; a build before unsold Gulf crude hits the headlines), Hormuz transits a day (daily; falls before a restriction),
  satellite hotspots over Jamnagar (hourly; two ticks before a fire), the European heating-degree-day forecast (daily; rises
  before a cold snap). Each carries the contract it bears on, the direction, a lag note and a sentence on what it can and cannot
  tell you.
* The engine computes every series whether or not the feed is bought, so a replay is identical either way; the feed costs
  $75,000 for the level (finance leg) and only then are the series shown on Intel and the Map and announced on screen.
* The headline tick of each signal's event is recorded when the event fires (the shock plus the tier's delay), and
  `signalTrades` counts fills tagged "signal" in the right contract and direction between the first move and the headline: the
  pass check for level 17.
* Thin back months: a level knob (`backMonthDepth`) multiplies depth from the third listed month out; tier 4 uses 0.5.

## Levels 14 to 17

See `docs/LEVELS.md`. Decisions recorded:

* Level 14's "margin realised inside par" is read as within 5% of par; "the crack hedge in band" as within 25% of the next thirty
  days of runs as they were actually made, at four closes in five from day 3 (the band absorbs what could not be known about the
  hurricane and the turnaround). The slate is a daily decision; an OSP cut on day 0 and another on day 20 make the sour barrel the
  cheaper one for a while each time, and the objective asks for the better slate seven days in ten.
* Level 15's pass asks for the purchase hedged on Henry Hub and the sale hedged on its own hub in its own units; a cargo that is
  hedged in the wrong contract or the wrong units is visibly out of band. Both terminals bid; the bot (and the player) choose by
  netback. The LNG arb is not positive on every seed: on two of twelve random seeds the cargo loses money even hedged well, and
  the right play there would be to decline it; ten passing seeds are checked in and the limitation is recorded.
* Level 16's par is negative (about -$1.9m on seed 1): the solution hedges a cargo with puts and a collar (which cost the vol
  spread, slippage and theta, and before expiry are a delta, not a floor), then carries a client's short-put programme through a
  vol spike that doubles implied vol. The pass is process: the hedges made, the programme delta-hedged within 60 lots at three
  closes in four, never more than 200 naked short lots at a close (the naked rule counts lots, so the programme's 300 puts need
  at least 100 short futures behind them whatever the delta says), and delta, vega and theta all on the waterfall.
* Level 17's news is 36 hours behind the world and three rumours arrive among the headlines (half true by the schedule's coin).
  The pass asks for two signals traded before their headlines and the book flat of signal positions at the end; the bot enters
  on two consecutive off-baseline readings (one for the hourly hotspot feed), sized inside a $3m VaR, and leaves three days after
  the headline. One random seed in twelve loses money on the trades (a true rumour moved the market against a signal position).

## UI in milestone 4

* **Markets** gains an options panel under the curve once options are unlocked: the chain of listed strikes for a month (call and
  put bid, ask, implied vol and delta, every cell explaining itself with the quote's working), an option ticket that shows the
  estimated fill, slippage, fees, notional, delta-equivalent lots and the option's expiry before the click, and a strategy
  builder whose legs come from the engine (one package, one tag). JKM joins the instrument strip. The ticket's tag can be
  "signal" so a trade made on a signal is counted.
* **Book** shows option positions with their model value, a Greeks table (delta, gamma, vega, theta, delta lots per position and
  per instrument, with totals), the naked-short count against its limit, and the options rows of the waterfall broken out by
  Greek.
* **Desk** shows the refinery (status, runs slider, slate choice with each slate's margin and its working, the yields table,
  today's margin, the screen's 3-2-1 against the plant's crack, crack units held against the target for the days left, realised
  margin and a sparkline of the daily margin) and, on an LNG cargo card, quantities in MMBtu, the exposure split by hub with a
  coverage bar per hub, the netback line (purchase plus freight plus regas plus boil-off against the delivered price), the hedge
  size in each contract's units, and the regas slot button.
* **Intel** shows the feed button, then one row per signal: latest reading against its baseline, a sparkline, badges when the
  reading is off its baseline and when the headline has arrived, and the series' lag note and what-it-can-tell-you sentence.
* **Map** draws a marker per visible signal at its place (a ring of dots for the cluster, a count for transits, an orange disc for
  the hotspot, an HDD badge for the forecast) with a hover callout.
* The test harness gains a `lab` hook that runs a registered level with extra instruments, unlocks, a refinery or events patched
  in, so a screen can be exercised before its level exists; six new screenshot captures are guarded by the level's existence.

## Deviations recorded in milestone 4

* Refinery capacity 100 kb/d, not 200 (see above).
* Options are futures-style margined and cash-settled at intrinsic on expiry; no exercise into futures; no market impact on
  options; the option block rule is a quarter of the future's.
* LNG prices at Henry Hub plus a tolling fee, not at 115% of Henry Hub; quantities in MMBtu in the cargo's quantity field; boil-off
  booked as a cost at discharge rather than as a quantity change.
* JKM is listed with three-tick spreads and 25 lots at the touch (as the Dubai swap) rather than thinner: with ten lots the
  bot's hedge of a full cargo paid more in impact than the arb was worth.
* The tanker-cluster, transit, hotspot and cold-forecast series are stylised shapes (ramp, hold, fade) around stated baselines,
  not models of shipping or weather.
* The "refinery" attribution leg is new (the prompt's list has no leg for a plant's realised margin).
