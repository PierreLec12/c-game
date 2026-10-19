# Build prompt: DESK, a commodity trading game

This file is a prompt. Put it at the root of a new, empty repository as `BUILD_PROMPT.md` and tell the building session:
"read BUILD_PROMPT.md and build milestone 1". Written 2026-10-19. "Desk" is the working title; use whatever the repository is
called.

The game is a new project. It is not part of c-terminal (Pierre's market terminal, github.com/PierreLec12/c-terminal) and must
not depend on it. c-terminal is named below only as a reference to read when porting a piece of maths or a reference table.

---

## 0. How to work from this prompt

You are building a single-player commodity trading game: a trader's desk with everything a real desk has, run on an accelerated
clock, with a curriculum that teaches the job one concept at a time by making the player do it and lose money safely when they
get it wrong.

Build it in the five milestones of section 13, in order. Each milestone ends with: all tests green, the new tests added,
`docs/DESIGN.md` updated with what was actually built and every deviation from this prompt, screenshots retaken, one commit per
coherent step with a plain-language body saying what and why. Do not start the next milestone with a red suite. When this prompt
is wrong about something that does not matter to the player, fix it and record it. When it is wrong about something the player
would notice, stop and ask.

Where this prompt gives a number (a vessel size, a voyage length, a margin rate), it is a stylised game parameter, not a market
fact. Put each one in the engine's `refdata` module with the day it was chosen and what it was based on, and label it "stylised"
on screen wherever a player could mistake it for a real figure.

---

## 1. Mission

The player who finishes the curriculum should be able to:

* read a curve and a spread and say what the market is telling them;
* buy a physical cargo, charter the ship, choose the route, price it against the right benchmark over the right window, hedge the
  flat price with the right number of lots over the right dates, roll the hedge, and explain afterwards where every dollar of P&L
  came from (flat price, basis, time spread, freight, finance, quality);
* size positions to a risk limit and keep them there through an event;
* trade products, gas and LNG with the right conversions and the right seasonal instincts;
* hedge with options and know what the Greeks are doing to the book;
* tell signal from noise in news, releases and alternative data, and act before the headline;
* run a working-capital constraint, a letter of credit and a counterparty's credit like a cost, not an afterthought.

What the game cannot teach, and must say so in its own About screen: relationships, negotiation with a real person, the politics
of a trading floor, and real market microstructure. The engine is a model. A player who beats it has learned the mechanics, the
discipline and the vocabulary, which is what the game is for.

The game must not be easy. A player who ignores the mentor and trades on gut should lose their book by level 6 and be told why.
Difficulty rises one concept at a time (section 9), and each level is proven solvable by a scripted solution (section 12).

Second purpose: a portfolio piece. An interviewer must be able to open a link and play level 0 in two minutes with nothing to
install. That drives the stack choice in section 3.

---

## 2. Non-negotiables

1. **Pure engine, dumb UI.** The engine is a library with no knowledge of the screen: it takes a state and a list of actions and
   returns the next state. Every rule of the game is testable without a browser. The UI renders state and submits actions.
2. **Determinism.** Given a seed, a level and the ordered list of player actions, the engine reproduces the same world
   bit-for-bit. Test it. This is what makes replay, debriefs, solution bots, what-ifs and later multiplayer possible.
3. **Every number explains itself.** Hovering any figure shows what it is, what it was derived from and at which tick. In a game
   this is a teaching device, not a compliance one: the hover on a P&L number names the legs; the hover on a quote names the bid,
   the ask and the depth; the hover on a cargo's value names the pricing basis and window. Nothing on screen is a bare number.
4. **Missing is missing.** A value the engine has not produced yet (a contract not listed, a cargo not yet priced) shows as
   "not yet", with the reason, never as zero or as yesterday's figure.
5. **Stylised, and says so.** Every reference figure (vessel sizes, voyage days, chokepoint shares) is labelled stylised, with
   its origin in `refdata`. Crisis levels based on real episodes are named as stylised analogues, never as the episode.
6. **Offline.** The game runs with no network after it has loaded: no map tiles fetched at run time, no API calls, no
   telemetry. The map is drawn from a bundled coastline file. This keeps it honest (nothing is quietly real), fast, and
   deployable as static files.
7. **2D only.** Canvas or SVG. No WebGL scenes, no 3D, no physics engine. Fun comes from legibility, speed and consequence.
8. **No multiplayer in this build**, but leave the seams described in section 3.5.
9. **Nothing from c-terminal is imported.** Pieces of it are re-implemented here with their own tests (section 3.6).

---

## 3. Architecture and stack

### 3.1 Stack (default; the owner may override before milestone 1)

TypeScript end to end, one repository, pnpm workspaces:

```
packages/engine        the simulation: pure TypeScript, zero DOM, zero I/O, tested with vitest
packages/content       the curriculum, mentor cards, glossary, event library: data plus small functions, also pure
apps/web               React 18 + Vite, Zustand for UI state, the game screens, the canvas map, Recharts or hand-drawn SVG
                       for curves and waterfalls; persistence in IndexedDB (seed + action log per save slot); static build
docs/                  DESIGN.md (as built), LEVELS.md (the curriculum as shipped), screenshots/
```

Why this and not Python: the engine has to run the clock at twelve ticks a second with ships moving and numbers updating, and
the result has to be playable from a link. A browser-resident engine does that with no server to run or pay for, deploys to
GitHub Pages, and because the engine is pure it can later be hosted in a Node process unchanged for multiplayer. The maths the
game needs (Black-76, a historical VaR, spreads, conversions) is a few hundred lines and ports in a day.

If the owner prefers a Python engine (familiarity, reuse of ideas from c-terminal), the alternative is FastAPI serving the same
engine over a WebSocket tick stream to the same React front end. Record the choice in `docs/DESIGN.md` before writing code.
Do not use Streamlit: it cannot run a game loop or animate a map.

### 3.2 The engine's contract

```ts
type State      // the whole world at one tick: markets, book, cargoes, voyages, tanks, cash, counterparties, news, level
type Action     // one typed player action (section 6), tagged with a player id (always "p1" for now)
type Refusal    // why an action was not accepted, in one sentence the player can act on

tick(state: State, actions: Action[], rng: Rng): { state: State; refused: Refusal[]; events: EngineEvent[] }
replay(seed: number, level: LevelId, log: Action[]): State
```

`State` is a plain serialisable object. `tick` advances one simulated hour. `EngineEvent` is what the UI animates and the
mentor reacts to (fill, settle, margin call, news, event, arrival, card unlocked, level passed).

Module layout inside `packages/engine/src`:

```
world.ts          the latent state: balances, inventories, geopolitics index, season, freight supply, gas storage
markets.ts        fair values and quotes for every instrument from the world state; the curve builder; the vol surface
physical.ts       cargoes, pricing formulas and windows, quality, Incoterms, laycans, nominations
shipping.ts       vessels, routes, voyages, chokepoints, rerouting, demurrage, floating storage
storage.ts        tanks: leases, fill, cost of carry, blending (late levels)
refinery.ts       the stylised refinery (yields, runs, margins)
gas.ts            HH, TTF, JKM, storage seasons, degree days, LNG cargoes and regas
finance.ts        cash, credit line, letters of credit, financing cost, futures margin, FX
liquidity.ts      bid-ask, depth, slippage, impact; physical tenders and quotes from counterparties
counterparties.ts the named NPCs: producers, refiners, traders, shipowners, banks, an inspector
events.ts         the event library, scheduling, shocks, the news each event emits
information.ts    what the player is told, when, and how reliably (delays, rumours, releases, signals)
pnl.ts            mark-to-market and attribution by leg
risk.ts           limits, VaR and stress on the book, the risk manager's reactions
scoring.ts        level score, rank, achievements
options.ts        Black-76 price, Greeks, implied vol (port from c-terminal cterm/metrics/options.py, with its tests)
rng.ts            seeded, splittable random streams (one per subsystem, derived from seed + name)
actions.ts        the action vocabulary and its validation
refdata.ts        every stylised parameter with its origin and date
engine.ts         tick(), replay()
```

### 3.3 Clock

One simulated hour per tick. Speeds: pause, 1x (one tick per two real seconds), 4x, 12x, and "to next event". The clock
auto-pauses on an event card, a new tender, a margin call, a limit breach, a mentor card the player has not seen, and at every
session close. Weekends and exchange holidays are skipped for prices and run for ships. A level is 20 to 90 simulated days.
The UI drives the clock with `requestAnimationFrame`, calling `tick` the right number of times per frame; the engine never reads
a wall clock.

### 3.4 Persistence

A save is `{ seed, level, log: Action[] }` plus a cached latest `State` for fast load. Saves live in IndexedDB, exportable and
importable as JSON (a run can be sent to someone, or attached to a bug report). A test proves that replaying the log from the
seed equals the cached state.

### 3.5 Seams for later multiplayer (build nothing, leave the doors)

* `tick` already takes actions from any number of players tagged by id.
* Orders reach the market only through `liquidity.submitOrder`; other players' orders would enter the same way.
* Counterparties implement `quote()` and `decide()`; a human counterparty would implement the same interface.
* The seed and action log make a server-authoritative replay possible; a Node host can run the same engine package.

### 3.6 What to port from c-terminal (re-implement, with tests; never import)

Read these for the formulas and the edge cases, then write them in TypeScript with vitest tests that check the same numbers:

* `cterm/metrics/options.py`: Black-76 price and Greeks, implied vol by bisection, payoff curves and breakevens, strategy builder.
* `cterm/metrics/book.py`: mark-to-market rules, historical-simulation VaR, stress re-pricing.
* `cterm/prep/drills.py`: conversion constants (7.33 bbl/t crude, 7.45 bbl/t gasoil, 3.412 MMBtu/MWh, 42 gal/bbl, 252 days)
  and the drill generators (spread, P&L, percentage, gallons to barrels, MMBtu to MWh, tonnes to barrels, kb/d to Mt/y, 3-2-1).
* `cterm/positions.py::INSTRUMENTS`: contract sizes and tick sizes for Brent, WTI, RBOB, ULSD, HH, TTF.
* `cterm/refdata/signals.py`: the chokepoint list and the shares of trade, to label as the reference they are.

---

## 4. The world

Stylised, 2D, named. Everything on the map is in `refdata.ts` with a note on what it is based on.

**Map base**: Natural Earth 110m land and coastline (public domain) bundled as GeoJSON, drawn once to an offscreen canvas in an
equal-earth or Robinson projection via d3-geo; ships, ports, routes, chokepoints and callouts drawn on top each frame.

**Ports** (load and discharge; each with lat/lon, typical cargo sizes, draft limits that gate vessel class):
Ras Tanura, Basrah, Fujairah, Es Sider, Bonny, Houston, Corpus Christi, Cushing (pipeline hub, storage only), St James,
Rotterdam, Sullom Voe, Primorsk, Novorossiysk, Singapore, Ningbo, Chiba, Jamnagar, Sabine Pass and Freeport (LNG load),
Zeebrugge and Gate (LNG discharge), Sodegaura (LNG discharge).

**Chokepoints**: Hormuz, Bab el-Mandeb, Suez, Malacca, Bosphorus, Danish Straits, Panama, Cape of Good Hope (the bypass),
Gibraltar, Taiwan Strait. Each has a status (open, restricted, closed), a transit delay, and a shock to freight and to regional
differentials when it changes.

**Routes**: polylines through waypoints that keep ships off land (hand-placed waypoints are fine; test that no route segment
crosses the land polygon), with a stylised distance and days at sea at 12.5 knots laden and 13.5 ballast. Closing a chokepoint
reroutes affected voyages automatically and shows the detour on the map with its extra days and cost.

**Vessels** (classes, stylised):

| Class | Cargo | Typical use | Hire, $/day (base) |
|---|---|---|---|
| MR | 300 kb products | products, short haul | 20,000 |
| LR2 | 650 kb products | products, long haul | 32,000 |
| Aframax | 600 kb crude | North Sea, Med, USGC | 35,000 |
| Suezmax | 1,000 kb crude | West Africa, Black Sea | 45,000 |
| VLCC | 2,000 kb crude | Gulf to Asia, USGC to Asia | 55,000 |
| LNGC | 174,000 m3 (about 3.6 TBtu) | LNG | 80,000 |

Freight is quoted in $/day (time charter) and as a lump sum or $/bbl (voyage charter); Worldscale is a concept card and a
derived number, not the primary quote.

**Storage**: tanks at Cushing, Rotterdam, Fujairah, Singapore, Saldanha Bay; a lease has a monthly cost per barrel, a minimum
term and a fill/empty rate. Floating storage uses a chartered vessel at anchor.

**The refinery** (level 14 onward): one stylised 200 kb/d plant with a fixed yield vector (gasoline, diesel, jet, fuel oil), a
run-rate decision, a crude slate choice between two grades, and a maintenance event.

**Counterparties**, each with a name, a type, a credit rating, a behaviour profile and a memory of the player: three producers
(national, major, independent), four refiners (European, Asian, US Gulf, a small one that pays late), three traders (one
aggressive, one reliable, one that disappears in level 11), three shipowners, two banks, one inspector. Ratings move with
events. A counterparty remembers a dispute and quotes worse afterwards.

**Calendar**: exchange sessions and settlements, contract expiries shaped like the real ones (Brent on the last business day of
the second month before delivery, WTI three business days before the 25th), a Wednesday inventory release, a daily European gas
storage figure, OPEC meetings, a Friday positioning report, a hurricane season, a heating season, a maintenance season.

---

## 5. The market engine

### 5.1 Instruments

Futures: Brent, WTI, RBOB, ULSD, Henry Hub, TTF, with real contract sizes and tick sizes. Swaps: Dubai, JKM. Assessments:
Dated Brent, gasoil 0.1% Rotterdam barges, 3.5% fuel oil. Physical grades on a quality grid: Arab Light, Basrah Medium, Forties,
Bonny Light, WTI Midland, Urals, Es Sider. Freight routes as quotes. EURUSD. Twelve listed months per future, quarters and
calendar strips behind them. Options on the six futures.

### 5.2 Fair values from the world state

A latent state drives everything; prices are observations of it with noise and friction. The state has: global crude balance
(kb/d), OECD and US inventories versus a seasonal normal, product inventories by region, refinery runs, a geopolitics risk index,
freight tonne-mile demand versus fleet, gas storage in the US and Europe versus normal, degree days, LNG arrivals, and a
liquidity regime.

Rules to implement and test as invariants:

* **Flat price** mean-reverts slowly to a fundamentals anchor set by the balance and the inventory gap, with a volatility that
  rises with the geopolitics index and event intensity. Daily log returns have fat tails (Student-t, 4 degrees of freedom).
* **Term structure follows inventories**: high inventories give contango bounded by storage cost plus finance (full carry); low
  inventories give backwardation whose steepness rises with prompt tightness. The front spread is the most volatile point. Test:
  the one-month contango never exceeds full carry by more than the noise band for more than two sessions; backwardation widens
  when prompt tightness rises.
* **Brent minus WTI** follows US inventories, export capacity utilisation and transatlantic freight; it cannot stay below the
  cost of moving a barrel from Houston to Rotterdam for long (the arb closes it).
* **Dubai minus Brent** moves with the geopolitics index, the Gulf loading programme and Asian refinery runs.
* **Dated minus front futures** rises with prompt tightness and falls when cargoes go unsold; published once a day.
* **Grade differentials** sit on a quality grid (API and sulphur) around Dated or Dubai and move with the product cracks (a sour
  grade cheapens when fuel oil weakens) and with grade-specific events.
* **Cracks** follow product inventories, runs and season: gasoline strong into summer, diesel strong into winter, fuel oil
  weak. The 3-2-1 crack is a derived number tradable as a package.
* **Freight** rises with tonne-mile demand (longer routes when a chokepoint closes), falls when the fleet idles, spikes on a
  closure, and feeds back into geographic spreads.
* **Gas**: HH from US storage versus the five-year normal and degree days; TTF from European storage, Norwegian flows, LNG
  arrivals and degree days; JKM as TTF plus an Asian premium; the LNG arb (HH plus liquefaction plus shipping plus regas versus
  TTF or JKM) as a derived number. Injection season fills storage, withdrawal drains it, a cold snap drains it faster.
* **Vol surface**: one implied vol per instrument and tenor with a term structure and skew, driven by the realised regime and the
  event calendar (vol rises into a known release and falls after).
* **FX**: EURUSD as a slow random walk, enough to make the TTF book show an FX leg.

### 5.3 Liquidity and fills

Every tradable instrument has a bid-ask and a depth that depend on the month (front deep, twelfth month thin), the time of day
(thin at the open and in Asian hours for European contracts) and the regime (depth halves in stress). A market order fills at the
touch plus slippage proportional to size over depth; a limit order rests and may not fill; impact moves the mid by a fraction of
the order and decays over following ticks. A block above a stated share of daily volume is refused with a message naming the
share. The player sees spread and depth before trading and the fill after. Options trade at model value plus a vol spread.

Physical liquidity is tenders and quotes: a counterparty offers a cargo (grade, size, laycan, pricing basis, differential,
Incoterm, port) or bids for one. Offers arrive at a rate set by the level, stay open a stated number of ticks, and are sometimes
mispriced on purpose so an attentive player profits and an inattentive one is trapped (a pricing window that leaves a hidden time
spread, a demurrage clause, a counterparty whose rating just fell).

### 5.4 Events and news

An event library, each entry with: a trigger (scheduled, probabilistic by level, or caused by the player), shocks to the world
state over a horizon, the news it emits (headline, body, source type, delay, reliability), and the concept card it unlocks.
Minimum library:

* Supply: OPEC+ cut or hike (scheduled meeting, with a leak the day before that is right two times in three), a field outage, a
  port strike, a pipeline leak, a sanctions package, a tanker seizure.
* Chokepoints: Red Sea restricted, Hormuz threatened then closed, Suez blocked by a grounding, Bosphorus fog.
* Demand: a recession scare, a China stimulus, a heatwave, a cold snap, a Gulf of Mexico hurricane (refineries down, gasoline
  up, crude down, ports closed).
* Operations: a refinery fire (a satellite hotspot appears at its coordinates two ticks before the headline), a quality claim,
  a demurrage dispute, a counterparty default, a bank tightening the line.
* Market structure: an expiry squeeze on the front month, a negative-price day on a landlocked contract (stylised), a vol spike.
* Macro: a USD move, a rate move changing financing cost.

Early levels give clean, timely headlines; later levels mix rumours (some false), delayed confirmations, and signals that arrive
before the news (a tanker cluster forming at anchor, a transit count falling, a hotspot, a cold forecast). Every false rumour is
later resolved on screen as false, so the player learns the base rate.

---

## 6. The player's actions

Each has a validator, a cost, an unlock level, and a one-line mentor explanation shown the first time it is available.

**Paper**: buy/sell futures (market, limit, stop), spreads as a package (time, inter-commodity, 3-2-1 crack), roll, EFP against
a cargo, buy/sell options (vanilla and the standard strategies), close.

**Physical**: accept a tender, bid on one, offer a cargo, choose Incoterm (FOB, CIF, DES), choose pricing basis (Dated, front
Brent, Dubai, WTI, HH, TTF, JKM) and window ("5 days after B/L", "month average M+1", "deemed B/L"), nominate a vessel, set
laycan, instruct the ship (route, speed, wait at anchor), discharge, resell afloat, divert, store, blend (late), set a quality
clause, claim or settle a dispute.

**Shipping**: fix a voyage charter, take a time charter, release a vessel, order floating storage, accept or contest demurrage.

**Storage**: lease a tank, fill, draw, release, blend two grades (level 13 onward).

**Refinery** (level 14 onward): set runs, choose the slate, hedge the crack, sell products.

**Gas and LNG** (level 15 onward): trade HH, TTF, JKM; buy a FOB LNG cargo, book shipping and a regas slot, deliver DES.

**Finance**: draw and repay the credit line, open a letter of credit, prepay a producer for a discount, convert currency, post
margin, request a limit change from the risk manager (granted or refused by track record).

**Information**: buy an assessment feed (information costs money), ask the mentor, open a concept card, run a what-if.

**Meta**: pause, set speed, end the session, end the level, replay a level, open the debrief, export the run.

---

## 7. Finance and risk

* **Cash and credit**: stated capital and credit line per tier. Every movement is a ledger row. Futures need initial margin
  (a share of notional per instrument) and variation margin at each settle; a margin call pauses the clock and gives the player
  until the next close to fund it or be liquidated at the touch. A letter of credit costs a fee and uses the bank line. Financing
  accrues daily on cargo value from payment to receipt. The line has a limit, a cost on the drawn part and a covenant (a drawdown
  that breaches it cuts the line).
* **FX**: the TTF book and European tank leases are in EUR; the book shows an FX leg.
* **The risk manager** is a named NPC. Limits: one-day 95% VaR by historical simulation on the simulated closes, net and gross
  position limits per instrument, a stop-loss per level, a drawdown limit for the run, a concentration limit per counterparty.
  A breach: a warning card with the number and the formula, then a forced reduction, then the loss of a life (three per tier).
  Losing the last life ends the level with a debrief; the player replays it.
* **Stress**: full re-pricing of the book under price and vol shocks, shown as a table the risk manager quotes in warnings.

---

## 8. P&L attribution and scoring

Every settle writes attribution rows per leg, shown as a waterfall: flat price, basis (Dated versus futures, grade
differential), time spread (window mismatch), freight, demurrage, finance and LC fees, storage, quality claims, options (delta,
gamma, vega, theta), FX, fees and slippage. Each row has one sentence saying what moved ("Brent front fell $1.20 while your cargo
was unpriced: unhedged flat-price exposure of 600 kb").

**Level score**, shown with its formula:

```
score = 100 * clamp(pnl / par, -1, 2)        par = the solution bot's P&L on the same seed
      + 50  * process                        the level's own checklist in [0, 1] (hedge in band during the window, no demurrage,
                                             VaR inside limit, cash never negative, ...)
      - 25  * max_drawdown / capital
      + 25  * debrief_quiz                   share of debrief questions answered right
```

Pass: score at least 100 and no life lost, or the level's own stricter rule. Ranks by cumulative score: Operator, Junior Trader,
Trader, Senior Trader, Book Head, Partner. Achievements for behaviours worth rewarding ("First hedge inside the window", "Zero
demurrage quarter", "Rode out Hormuz under limit", "Called the rumour false"). The score is a card with a bar per component.

---

## 9. The curriculum

Twenty-one levels in five tiers, each a module in `packages/content/src/levels/level_NN.ts` with: the player-facing briefing,
the scenario (seeded world parameters and scheduled events), unlocks, the pass rule, the mentor cards, the traps, and a solution
bot. Tier knobs: volatility regime, event rate, information delay and rumour share, liquidity depth, counterparty quality,
mentor verbosity, number of instruments, limit tightness, capital.

### Tier 0: the screen

* **0. Orientation** (one session). The clock, the ticker, a quote with bid and ask, lot and tick value, the Book. Mission:
  buy one Brent lot, watch the mark move for a session, sell it, read the P&L and its hover. A six-question conversion drill.
  Pass: drill 6 of 6, one round trip. Cards: "What a lot is", "Why the ask is above the bid", "A tick and a settle".

### Tier 1: paper (levels 1 to 4; 10 to 20 days; low vol; no events; timely news; deep liquidity)

* **1. Flat price and margin.** Hold through settles; variation margin moves cash; a stop-loss. Trap: a position sized to the
  whole line gets a margin call on day three. Pass: positive P&L, no margin call, VaR inside the limit every close. Cards:
  "Initial and variation margin", "Size before direction", "Mark-to-market".
* **2. Term structure.** The curve, contango and backwardation, the roll. Scenario: high inventories, contango; hold a long two
  months and pay the roll twice; then the same in backwardation. Pass: a correct debrief on which structure paid the long and
  why, roll cost inside par. Cards: "Contango is a storage price", "Roll yield", "Full carry".
* **3. Spreads.** Time and inter-commodity spreads as packages, spread margin offsets, the 3-2-1 crack. Scenario: a Cushing
  build widens Brent-WTI; a turnaround strengthens the crack. Pass: two spread trades with spread P&L in the attribution and
  gross exposure under the limit. Cards: "A spread is a view on a relationship", "Brent-WTI is a pipeline and a ship", "The
  crack is a refinery's margin".
* **4. Information.** The release calendar: the Wednesday inventory number with consensus and actual, an OPEC meeting with a
  leak, positioning. Scenario: three releases; one leak false. Pass: no position above the limit into a release; a correct
  debrief on what was priced and what happened. Cards: "Expected versus actual", "Positioning is a crowd", "A rumour has a
  base rate".

### Tier 2: the cargo and the hedge (levels 5 to 9; 30 to 45 days; moderate vol; first events; physical unlocked)

* **5. First cargo, unhedged on purpose.** Buy one Aframax of Forties FOB Sullom Voe at Dated plus a differential, pricing 5
  days after B/L; fix the ship; sell CIF Rotterdam at Dated plus a differential pricing 5 days after discharge. Watch it sail on
  the map with its days and freight. Brent moves $4 during the voyage. Pass: delivery, no demurrage, and the player can point at
  where the P&L came from. Designed to lose money often enough that level 6 means something. Cards: "FOB, CIF, DES", "Laycan
  and B/L", "A pricing window is an exposure".
* **6. The hedge.** Same trade with Brent futures: compute lots from barrels, sell the hedge when the purchase prices, buy it
  back when the sale prices, matched to each window. Attribution shows a quiet flat-price leg and a basis leg. Trap: hedging on
  the month that expires mid-voyage forces a roll. Pass: hedge ratio within 10% of one through both windows, flat-price leg
  inside the noise band. Cards: "Lots from barrels", "Hedge the window, not the cargo", "The gap between hedge and cargo is
  basis".
* **7. Basis and quality.** Dated versus futures, a grade differential moving against the player, an Asian sale priced on Dubai
  leaving a Brent-Dubai exposure. EFP introduced. Pass: a cargo sold East with the EW spread hedged or explained; a quality claim
  handled. Cards: "Basis risk", "Why Dubai", "EFP: paper for the cargo".
* **8. The hidden time spread.** A purchase priced on a month average and a sale priced on a 5-day window a month later: the
  player is long a time spread without choosing it; in backwardation it bleeds. Pass: name the exposure in the debrief and hedge
  it with a spread in the second run. Cards: "Window mismatch is a spread", "Backwardation taxes the long cargo", "Deemed B/L".
* **9. Freight and chokepoints.** A Gulf cargo to Rotterdam; the Red Sea is restricted mid-voyage; reroute via the Cape or pay
  war risk and wait. Floating storage appears when the curve is in contango. Pass: delivery with the freight leg inside par,
  demurrage under one day. Cards: "Freight is a share of the barrel", "A chokepoint is a time spread and a freight shock at
  once", "Storage on water".

### Tier 3: money, counterparties, limits (levels 10 to 13; 30 to 60 days; more events; delayed news; first rumours)

* **10. Working capital.** Three cargoes offered at once; the line and LC fees make the third unaffordable; prepaying buys a
  discount at a cost. Pass: cash never negative, finance leg inside par, one cargo declined with a stated reason. Cards: "Cost of
  carry includes money", "A letter of credit is a promise and a fee", "Prepayment is a loan".
* **11. Counterparties.** The small refiner pays late; the aggressive trader offers the cheapest cargo and defaults; the
  inspector finds off-spec sulphur. Ratings on screen, insurance available. Pass: exposure to the defaulting name under the
  concentration limit, a dispute settled. Cards: "Cheapest for a reason", "Concentration", "Due diligence is a position".
* **12. The risk manager.** Tight VaR, stress shown, a geopolitical scare doubles vol. Pass: inside limits every close with a
  stated P&L target; at most one life lost. Cards: "VaR is a quantile, not a maximum", "Gross versus net", "Reduce before you
  are told".
* **13. Storage and carry.** Deep contango: lease tanks at Cushing, buy prompt, sell deferred, carry; the structure flips and
  the carry must be unwound. Blending unlocked. Pass: a profitable carry closed before the flip with the storage leg inside par.
  Cards: "Cash and carry", "Storage economics", "Blending to a spec".

### Tier 4: products, gas, options, signals (levels 14 to 17; 45 to 60 days; full event library; rumours; thin back months)

* **14. The refinery.** Run the plant, choose the slate, hedge the crack with 3-2-1 packages into driving season and a
  hurricane. Pass: margin realised inside par with the crack hedge in band. Cards: "Yields", "Seasonality of cracks", "A
  turnaround is a supply event".
* **15. Gas and LNG.** HH, TTF, JKM; injection season; an LNG cargo FOB Sabine Pass, shipping, regas at Gate versus Sodegaura;
  the EUR leg. Conversions enforced by the engine (a wrong MMBtu/MWh gives a visibly wrong hedge). Pass: an LNG cargo delivered
  with the netback hedged, the FX leg explained. Cards: "MMBtu, MWh, m3", "Netback", "Storage is the gas curve".
* **16. Options.** Hedge a cargo with a put and a collar; a producer hedging programme; delta hedging through a vol spike;
  theta. Pass: option hedges whose attribution shows the Greeks, no naked short options beyond the limit. Cards: "Black-76 in
  one screen", "Delta is a hedge ratio that moves", "Vol is a price".
* **17. Signals.** Floating storage building off Fujairah, Hormuz transits falling, a hotspot at Jamnagar two ticks before the
  headline, a cold forecast before the TTF move. News arrives late and one in four items is a rumour. Pass: two positions taken
  on a signal before the headline, the signal named in the debrief. Cards: "Lags", "Signal versus noise", "What a transit
  count can and cannot tell you".

### Tier 5: mastery (levels 18 to 20; 60 to 90 days; mentor silent; information degraded; liquidity dries in stress)

* **18. Crises (stylised, named as such).** Four in sequence: a landlocked expiry squeeze into negative prices, a European gas
  spike, Hormuz closed ten days, a Gulf hurricane. Pass: survive all four inside limits with drawdown under the tier limit.
* **19. The quarter.** Everything unlocked, a P&L budget, a risk budget, a full tender flow, counterparties that remember. No
  cards unless asked. Pass: budget met inside limits.
* **20. Partner.** Adversarial: liquidity halves in stress, counterparties price the player's known positions against them, a
  fresh seed every run, a leaderboard against the player's own past runs. Endless. Sandbox mode here too: any seed, any knob,
  no scoring.

### Solution bots

Every level ships `solve(state): Action[]`, a policy that passes the level on its default seed and nine others and whose P&L
sets `par`. A test runs every bot. If a bot cannot pass, the level is wrong, not the player.

---

## 10. The teaching layer

* **The mentor** has a name and a voice: dry, short, never cheerful about losses. Verbosity falls by tier: cards on every new
  thing in tier 1, on request in tier 5. A card is a titled panel with one diagram where it helps (an SVG curve, a pricing-window
  timeline, a map snippet), three sentences, a worked number from the player's own book, and a "show me" link that highlights
  the cell or the ship it talks about.
* **Concept callouts on the map**: a route shows distance, days, freight on the current quote and its share of the barrel; a
  chokepoint shows what passes through it and what happens to spreads and freight when it shuts; a port shows the vessel classes
  it takes and the grades it loads; a ship shows its cargo, its pricing window as a timeline, its hedge (lots, months) and the
  unhedged part in red; a tank shows fill, cost per month and the contango it needs to pay for itself.
* **The debrief** after each level: the attribution waterfall, a timeline of the player's actions over the price path, the
  solution bot's path on the same seed as a ghost line, five questions generated from what actually happened ("your basis leg
  lost $410k; which window was it?"), and the cards never opened.
* **What-if**: at any pause, "what if I had not hedged" and "what if I had hedged the whole window" replay the log with the
  hedge actions removed or completed and draw the two ghost P&L lines. Cheap, because the engine is deterministic.
* **Glossary** generated from the cards, searchable, with the level each term first appears.

---

## 11. UI and art direction

React, 2D, nine screens as routes with a persistent top bar (clock, speed, cash, P&L today, VaR versus limit, lives, rank).

1. **Bridge**: the risk gauges as arcs, the level objective checklist, the mentor's last line, the ticker, the next scheduled
   release, open tenders count.
2. **Markets**: curves of every instrument, spreads and cracks, the vol surface, the order ticket with bid, ask, depth, slippage
   estimate and margin impact before the click, open orders.
3. **Desk**: tenders and quotes with countdowns, the player's cargoes as cards (status, window timeline, hedge coverage bar),
   vessels, tanks, the refinery and the LNG chain when unlocked.
4. **Map**: the canvas world, ships as moving markers with fading trails, ports, chokepoints with status, hotspots and weather
   overlays, routes highlighted when a cargo is selected, the callouts of section 10, a time scrubber for the current level.
5. **Book and risk**: positions, Greeks, VaR, stress, the attribution waterfall, the limits table, the risk manager's messages.
6. **Intel**: news with reliability shown after resolution, the release calendar with consensus and actual, the signals (anchored
   tanker clusters, transits, hotspots, degree days) with their lags, positioning.
7. **Finance**: the ledger, margin account, credit line, LCs, financing accrual, FX.
8. **Academy**: the curriculum as a path of tiers and levels, cards, glossary, achievements, progress, About.
9. **Debrief**: section 10.

**Palette and feel**: deep navy background; saturated accents by family: crude amber, products magenta and teal, gas electric
blue, LNG cyan, freight sand, cash green, risk red, mentor violet. Ships are bright dots with trails; a chokepoint closing flashes
once and stays outlined; an event card slides in; a passed level gets a burst and a rank card; a lost life gets a red vignette
and the risk manager's sentence. Large numbers for P&L and cash, monospace for prices. Every colour passes WCAG AA contrast on
the navy. Fun means legible, fast, responsive and consequential, not decorated. No sound by default (a mute-by-default option is
fine later). Keyboard: space pauses, 1/2/3 set speed, N jumps to the next event.

**Performance**: 60 frames a second with 400 markers on the map on a 2020 laptop; a tick under 5 ms; the static build under
3 MB without the coastline file.

**Mobile**: the Bridge, Academy and Debrief readable on a phone; the rest desktop-first.

---

## 12. Testing and verification

* **Engine invariants** (vitest): determinism (section 2); cash conservation (every change in cash is a ledger row); no negative
  inventory in a tank; a voyage never arrives before its ETA at full speed; contango bounded by full carry; hedged variance below
  unhedged variance over 200 seeds on level 6; attribution legs sum to book P&L to the cent; a refused action changes nothing; an
  event's news never precedes its trigger unless the event says so (a leak); no route segment crosses land.
* **Ported maths**: Black-76 prices and Greeks against known values; VaR against a hand-computed small case; conversions.
* **Solution bots**: every level's bot passes on ten seeds; par written from the default seed and checked in.
* **Replays**: a stored run replays to an identical state; exported JSON round-trips.
* **UI**: component tests for the order ticket (what it shows before the click), the cargo card, the waterfall; a Playwright
  smoke test that plays level 0 end to end in the built app; an axe accessibility pass on each screen.
* **Screenshots**: a Playwright script that captures each screen at a fixed tick of a fixed seed, committed under
  `docs/screenshots/`.

---

## 13. Delivery plan

| Milestone | Builds | Done when |
|---|---|---|
| M1 Paper desk | repo scaffold, engine core (world, markets, liquidity, finance, pnl, risk, options, rng, actions, engine), persistence, clock, top bar, Bridge, Markets, Book and risk, Academy shell, levels 0 to 4 with bots and tier 1 cards, GitHub Pages deploy | tests green, tier 1 playable from a link, screenshots |
| M2 Cargo and ship | physical, shipping, counterparties (basic), events (chokepoints, supply), Desk, Map with ships and callouts, Debrief with attribution and what-if, levels 5 to 9 | tier 2 playable, hedged-variance test passes |
| M3 Money and limits | finance in full, counterparties in full, risk manager with lives, storage and blending, Finance screen, levels 10 to 13 | tier 3 playable |
| M4 Products, gas, options, signals | refinery, gas and LNG chain, options on the book, information degradation, signals into Intel and Map, levels 14 to 17 | tier 4 playable |
| M5 Mastery and polish | crises, the quarter, Partner and sandbox, leaderboard, achievements, theme and performance passes, docs, README with screenshots | all 21 bots pass, docs complete |

Each milestone: commits per coherent step, plain-language bodies, `docs/DESIGN.md` updated with the as-built state and
deviations, `docs/LEVELS.md` with the curriculum as shipped.

---

## 14. Stylised parameters to start from

Put these in `refdata.ts` with the note "stylised game parameter, chosen 2026-10-19 from public rules of thumb; not a market
figure". Adjust during balancing and record every change.

* Conversions: 7.33 bbl/t crude, 7.45 bbl/t gasoil, 3.412 MMBtu/MWh, 42 gal/bbl, 252 trading days.
* Contract sizes: Brent and WTI 1,000 bbl, tick 0.01; RBOB and ULSD 42,000 gal, tick 0.0001; Henry Hub 10,000 MMBtu, tick
  0.001; TTF 1 MWh per lot-unit, tick 0.005 EUR.
* Voyage days laden at 12.5 kn: Ras Tanura to Rotterdam via Suez 20, via the Cape 34; Ras Tanura to Ningbo 22; Houston to
  Rotterdam 15; Houston to Ningbo via Panama 30 (size-limited) or via the Cape 48; Sullom Voe to Rotterdam 2; Bonny to Rotterdam
  14; Novorossiysk to Jamnagar via Suez 16; Sabine Pass to Gate 13; Sabine Pass to Sodegaura via Panama 24.
* Initial margin as a share of notional: crude 8%, products 10%, HH 15%, TTF 20%; spread offsets 60% to 80%.
* Storage: Cushing $0.35/bbl/month, Rotterdam $0.60, Fujairah $0.55, Singapore $0.70; floating storage at hire plus insurance.
* Financing: a base rate the engine moves, plus 150 bp on the line; LC fee 0.25% of face per quarter.
* Volatility regimes (annualised): calm 20%, normal 30%, stressed 55%, crisis 90%.
* Tier capital and credit: tier 1 $5m and $20m; tier 2 $20m and $150m; tier 3 onward $50m and $400m.

---

## 15. Decisions the builder makes and records in DESIGN.md

* The stack, if the default of section 3.1 is changed.
* The factor model and its coefficients, with the invariant tests that bound them.
* The pricing-window vocabulary and how each window maps to ticks.
* The map projection, the coastline resolution and the waypoint set.
* Ticks per frame at each speed and the measured tick time.
* Level pars, and any level whose bot needed a rule change to pass.
* Anything in this prompt that proved wrong.

---

## 16. Definition of done

A visitor opens the deployed link and, with nothing installed, sees a navy desk and plays level 0 in two minutes. The owner
plays level 0 through level 20 with the clock running, loses money for understandable reasons and reads the reason in the
debrief, hedges a cargo in level 6 and watches the flat-price leg go quiet, reroutes a ship around the Cape in level 9 and sees
the days and the dollars, runs a carry in level 13, delivers an LNG cargo in level 15, holds a collar through a vol spike in
level 16, acts on a tanker cluster before the headline in level 17, and survives four crises in level 18. Every number explains
itself on hover. Every reference figure says stylised. The suite is green. The docs say what was built.
