import { describe, expect, it } from "vitest";
import { newGame, parFor, replay, runPolicy } from "@desk/engine";
import { CARDS, LEVELS, cardById, glossary, drillSet, checkDrill, parseNumber } from "../src/index";

describe("solution bots", () => {
  for (const spec of LEVELS) {
    it(`level ${spec.id} (${spec.title}) passes on its ten seeds and its par is the checked-in figure`, () => {
      expect(spec.seeds.length).toBe(10);
      for (const seed of spec.seeds) {
        const { state } = runPolicy(spec, seed, spec.solve);
        expect(state.level.status, `seed ${seed}: ${state.level.objectives.map((o) => `${o.id}=${o.status}`).join(", ")} pnl ${Math.round(state.pnl.total)}`).toBe("passed");
        expect(state.risk.livesLost).toBe(0);
      }
      if (!spec.noPar) expect(Math.round(parFor(spec, spec.seeds[0]) * 100) / 100).toBe(spec.par);
    });
  }
  it("a bot run replays to the identical state from its log", () => {
    const spec = LEVELS[1];
    const { state, log } = runPolicy(spec, spec.seeds[0], spec.solve);
    const again = replay(spec.seeds[0], spec.id, log, state.tick);
    expect(JSON.stringify(again)).toBe(JSON.stringify(state));
  });
  it("every level unlocks its cards during the bot's run and the quiz has a correct answer per question", () => {
    for (const spec of LEVELS) {
      const { state } = runPolicy(spec, spec.seeds[0], spec.solve);
      for (const c of spec.cards) expect(state.level.cardsUnlocked, `level ${spec.id} card ${c.id}`).toContain(c.id);
      for (const q of state.level.quiz) expect(q.correct).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("cards and glossary", () => {
  it("every card a level references exists and its worked example renders on a fresh state", () => {
    for (const spec of LEVELS) {
      const s = newGame(spec, spec.seeds[0], { par: 0 });
      for (const c of spec.cards) {
        const card = cardById(c.id);
        expect(card, c.id).toBeDefined();
        expect(card!.worked(s).length).toBeGreaterThan(5);
        expect(card!.sentences.length).toBe(3);
      }
    }
    expect(CARDS.every((c) => c.terms.length > 0)).toBe(true);
  });
  it("the glossary is generated from the cards with the level each term first appears in", () => {
    const g = glossary();
    expect(g.find((e) => e.term === "contango")?.level).toBe(2);
    expect(g.find((e) => e.term === "lot")?.level).toBe(0);
    expect(new Set(g.map((e) => e.term.toLowerCase())).size).toBe(g.length);
  });
});

describe("drills", () => {
  it("are seeded, self-checking and parse what a trader types", () => {
    const a = drillSet(7, ["spread", "pnl", "gal_bbl", "mmbtu_mwh", "tonne_bbl", "hedge_lots"]);
    const b = drillSet(7, ["spread", "pnl", "gal_bbl", "mmbtu_mwh", "tonne_bbl", "hedge_lots"]);
    expect(a).toEqual(b);
    expect(drillSet(8, ["spread"])[0].prompt).not.toBe(a[0].prompt);
    for (const d of a) expect(checkDrill(d, d.answer)).toBe(true);
    expect(checkDrill(a[0], a[0].answer + 1)).toBe(false);
    expect(parseNumber("-300,000")).toBe(-300000);
    expect(parseNumber("$ 1,234.5")).toBe(1234.5);
    expect(parseNumber("(300)")).toBe(-300);
    expect(parseNumber("-300k")).toBe(-300000);
    expect(parseNumber("+3.2 %")).toBe(3.2);
    expect(parseNumber("2.52 $/bbl")).toBe(2.52);
    expect(parseNumber("abc")).toBeNull();
  });
  it("level 0's six drills recompute from their parameters", () => {
    const spec = LEVELS[0];
    const s = newGame(spec, 1, { par: 0 });
    expect(s.level.drills.length).toBe(6);
    expect(s.level.drills.every((d) => d.working.length > 0 && Number.isFinite(d.answer))).toBe(true);
  });
});
