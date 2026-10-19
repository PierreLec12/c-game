import { describe, expect, it } from "vitest";
import { makeRng } from "../src/rng";

describe("rng", () => {
  it("is deterministic per (seed, name, tick) and independent across streams", () => {
    const a = makeRng(7).stream("prices", 12);
    const b = makeRng(7).stream("prices", 12);
    expect([a.uniform(), a.uniform(), a.normal()]).toEqual([b.uniform(), b.uniform(), b.normal()]);
    expect(makeRng(7).stream("prices", 13).uniform()).not.toBe(makeRng(7).stream("prices", 12).uniform());
    expect(makeRng(8).stream("prices", 12).uniform()).not.toBe(makeRng(7).stream("prices", 12).uniform());
    expect(makeRng(7).stream("world", 12).uniform()).not.toBe(makeRng(7).stream("prices", 12).uniform());
  });
  it("draws uniforms in [0,1) with the right mean and a unit-variance Student-t with fat tails", () => {
    const s = makeRng(3).stream("x", 0);
    let sum = 0, sumT = 0, sumT2 = 0, big = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) {
      const u = s.uniform();
      expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThan(1);
      sum += u;
      const t = s.studentT(4);
      sumT += t; sumT2 += t * t;
      if (Math.abs(t) > 4) big += 1;
    }
    expect(Math.abs(sum / n - 0.5)).toBeLessThan(0.005);
    expect(Math.abs(sumT / n)).toBeLessThan(0.02);
    expect(Math.abs(sumT2 / n - 1)).toBeLessThan(0.08);
    expect(big / n).toBeGreaterThan(0.0003); // a normal would give 6e-5 beyond 4 sigma
  });
});
