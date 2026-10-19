# DESK

A single-player commodity trading game: a trader's desk with everything a real desk has, run on an accelerated clock,
with a curriculum that teaches the job one concept at a time by making you do it and lose money safely when you get it
wrong.

**Play it:** https://pierrelec12.github.io/c-game/ (static, offline after load, nothing to install; level 0 takes two
minutes).

Milestone 1 ships the paper desk: tier 0 and tier 1 (levels 0 to 4), the engine core, the Bridge, Markets, Book and
risk, Intel, Finance and Academy screens, saves, the debrief with a solution-bot ghost line. Cargoes, ships and the map
come in milestone 2.

![Markets](docs/screenshots/markets.png)

## What it teaches (tier 1)

Lots, ticks and settles; sizing to a VaR limit before choosing a direction; initial and variation margin and what a
margin call does; contango, backwardation, full carry and the roll; spreads as packages, Brent-WTI and the 3-2-1 crack;
releases, consensus and surprise, positioning as a crowd, a leak's base rate. Every number on screen explains itself on
hover. Every reference figure is labelled stylised.

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
