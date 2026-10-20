import { describe, expect, it } from "vitest";
import { runPolicy, whatIf } from "@desk/engine";
import { LEVELS } from "../src/index";

/** Section 12: hedged variance below unhedged variance over 200 seeds on level 6. */
describe("the hedge", () => {
  it("cuts the variance of level 6's P&L over 200 seeds against the same runs with every hedge removed", () => {
    const spec = LEVELS.find((l) => l.id === 6)!;
    const hedged: number[] = [];
    const unhedged: number[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const { state, log } = runPolicy(spec, seed, spec.solve, 100000, { par: 0 });
      hedged.push(state.pnl.total);
      const naked = whatIf(seed, spec.id, log, "unhedged", state.level.endedTick ?? state.tick, { par: 0 });
      unhedged.push(naked.pnl.total);
    }
    const variance = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1); };
    const vh = variance(hedged), vu = variance(unhedged);
    expect(vh, `hedged sd ${Math.sqrt(vh).toFixed(0)} vs unhedged sd ${Math.sqrt(vu).toFixed(0)}`).toBeLessThan(vu * 0.25);
  });
});
