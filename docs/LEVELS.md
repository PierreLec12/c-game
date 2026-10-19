# The curriculum as shipped (milestone 1: levels 0 to 4)

Tier 0 and tier 1 of twenty-one levels. Each level is a module in `packages/content/src/levels/level_NN.ts` with the
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

## Not yet

Levels 5 to 20 are planned titles in the Academy and arrive with milestones 2 to 5.
