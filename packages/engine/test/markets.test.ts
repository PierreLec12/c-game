import { describe, expect, it } from "vitest";
import { makeRng } from "../src/rng";
import { fullCarry, priceParts, spreadTarget, structure, impliedVolAt } from "../src/markets";
import { ckey } from "../src/liquidity";
import { newGame, tick } from "../src/engine";
import { FACTORS } from "../src/refdata";
import { testLevel } from "./helpers";

describe("the factor model", () => {
  it("prices every contract as a sum of named parts", () => {
    const spec = testLevel({ id: 901 });
    const s = newGame(spec, 1);
    for (const key of Object.keys(s.contracts)) {
      const c = s.contracts[key];
      const tau = (c.expiryTick - s.tick) / 24 / 30.4375;
      const pp = priceParts(s.factors, c.inst, tau);
      expect(Math.abs(Object.values(pp.parts).reduce((a, b) => a + b, 0) - pp.price)).toBeLessThan(1e-9);
      expect(Math.abs(s.quotes[key].mid - pp.price)).toBeLessThan(1e-9);
      expect(s.quotes[key].bid).toBeLessThan(s.quotes[key].ask);
    }
  });
  it("structure is cumulative and decays", () => {
    expect(structure(0.5, 0)).toBe(0);
    expect(structure(0.5, 1)).toBeCloseTo(0.5, 12);
    expect(structure(0.5, 2)).toBeCloseTo(0.5 + 0.5 * FACTORS.structureDecay.value, 12);
    expect(structure(0.5, 1.5)).toBeCloseTo(0.5 + 0.25 * FACTORS.structureDecay.value, 12);
  });
  it("backwardation widens when prompt tightness rises; contango is capped at full carry", () => {
    expect(spreadTarget("BRENT", -10, 75, 0.04)).toBeGreaterThan(spreadTarget("BRENT", -30, 75, 0.04));
    expect(spreadTarget("BRENT", -30, 75, 0.04)).toBeLessThan(0);
    expect(spreadTarget("BRENT", 500, 75, 0.04)).toBeLessThanOrEqual(fullCarry("BRENT", 75, 0.04));
    expect(fullCarry("BRENT", 75, 0.04)).toBeCloseTo(0.6 + 75 * 0.04 / 12, 10);
  });
  it("one-month contango never exceeds full carry plus the noise band for more than two sessions", () => {
    const spec = testLevel({ id: 902, days: 30, world: { oecdInvGap: 80, usInvGap: 40 } }); // very high inventories
    const rng = makeRng(11);
    let s = newGame(spec, 11);
    let consecutive = 0, worst = 0;
    for (let t = 0; t < 30 * 24; t++) {
      s = tick(s, [], rng).state;
      if (s.tick % 24 !== 19) continue;
      const m = s.listed.BRENT;
      const spread = s.quotes[ckey("BRENT", m[1])].mid - s.quotes[ckey("BRENT", m[0])].mid;
      const cap = fullCarry("BRENT", s.factors.brentPrompt, s.world.baseRate) + FACTORS.carryNoiseBand.value;
      if (spread > cap) consecutive += 1; else consecutive = 0;
      worst = Math.max(worst, consecutive);
    }
    expect(worst).toBeLessThanOrEqual(2);
  });
  it("implied vol has a term structure and a put skew", () => {
    expect(impliedVolAt(0.3, 1)).toBeCloseTo(0.3, 10);
    expect(impliedVolAt(0.3, 12)).toBeLessThan(0.3);
    expect(impliedVolAt(0.3, 1, -0.1)).toBeGreaterThan(impliedVolAt(0.3, 1, 0.1));
  });
});
