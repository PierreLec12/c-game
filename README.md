# DESK

A single-player commodity trading game: a trader's desk with everything a real desk has, run on an accelerated clock,
with a curriculum that teaches the job one concept at a time by making you do it and lose money safely when you get it
wrong.

**Play it:** https://pierrelec12.github.io/c-game/ (static, offline after load, nothing to install; level 0 takes two
minutes).

Milestones 1 and 2 ship the paper desk and the physical desk: tiers 0 to 2 (levels 0 to 9), the engine core with cargoes,
pricing windows, ships, routes and chokepoints on a bundled coastline, the Bridge, Markets, Desk, Map, Book and risk, Intel,
Finance and Academy screens, saves, and the debrief with a solution-bot ghost line and what-if replays. Working capital,
counterparties in full, storage and the risk manager's lives come in milestone 3.

![Markets](docs/screenshots/markets.png)

![Map](docs/screenshots/map.png)

## What it teaches (tiers 1 and 2)

Lots, ticks and settles; sizing to a VaR limit before choosing a direction; initial and variation margin and what a
margin call does; contango, backwardation, full carry and the roll; spreads as packages, Brent-WTI and the 3-2-1 crack;
releases, consensus and surprise, positioning as a crowd, a leak's base rate. Then the cargo: FOB, CIF and DES, the laycan
and the bill of lading, a pricing window as an exposure, lots from barrels, hedging the window in a month that outlives it,
basis and grade differentials, selling East on Dubai, the EFP, the hidden time spread in mismatched windows, freight as a
share of the barrel, a restricted strait as a freight shock and a time spread at once, storage on water. Every number on
screen explains itself on hover. Every reference figure is labelled stylised.

## Run it locally

```
pnpm install
pnpm test          # engine, content and UI component tests
pnpm dev           # http://localhost:5173/c-game/
pnpm build         # static site in apps/web/dist
pnpm e2e           # Playwright smoke test of level 0 on the built site (pnpm exec playwright install chromium first)
pnpm screenshots   # retakes docs/screenshots/
```

## Layout

```
packages/engine    the simulation: pure TypeScript, no DOM, no I/O; tick(state, actions, rng) -> next state
packages/content   the curriculum: levels, cards, drills, mentor, glossary
apps/web           React + Vite, the screens, the clock, IndexedDB saves
docs/              DESIGN.md (as built, with every deviation from the prompt), LEVELS.md, screenshots/
```

Built from `BUILD_PROMPT.md`. Not part of, and not depending on, c-terminal; the options maths, the historical VaR and
the conversion constants were re-implemented from it with the same tests.
