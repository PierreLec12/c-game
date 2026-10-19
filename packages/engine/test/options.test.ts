import { describe, expect, it } from "vitest";
import { black76, breakevens, buildStrategy, expectedMove, impliedVol, payoffAtExpiry, payoffCurve, realisedVol, STRATEGIES, strategyOptionLegs, strategyStrikes, summarise } from "../src/options";

describe("Black-76 (ported from c-terminal with the same known values)", () => {
  it("matches a hand-computed value", () => {
    const g = black76("call", 20, 20, 4 / 12, 0.25, 0.09)!;
    expect(Math.abs(g.price - 1.1168)).toBeLessThan(0.001);
    const p = black76("put", 20, 20, 4 / 12, 0.25, 0.09)!;
    expect(Math.abs(p.price - g.price)).toBeLessThan(1e-12);
  });
  it.each([[100, 95, 0.5, 0.35, 0.04], [3.2, 3.5, 0.1, 0.6, 0], [75, 120, 2, 0.2, 0.05]])("put-call parity and bounds F=%s K=%s", (F, K, T, s, r) => {
    const c = black76("call", F, K, T, s, r)!;
    const p = black76("put", F, K, T, s, r)!;
    const disc = Math.exp(-r * T);
    expect(Math.abs(c.price - p.price - disc * (F - K))).toBeLessThan(1e-9);
    expect(c.price).toBeGreaterThanOrEqual(disc * Math.max(F - K, 0) - 1e-12);
    expect(p.price).toBeGreaterThanOrEqual(disc * Math.max(K - F, 0) - 1e-12);
    expect(c.delta).toBeGreaterThanOrEqual(0); expect(c.delta).toBeLessThanOrEqual(1);
    expect(p.delta).toBeLessThanOrEqual(0); expect(p.delta).toBeGreaterThanOrEqual(-1);
    expect(Math.abs(c.delta - p.delta - disc)).toBeLessThan(1e-9);
    expect(c.gamma).toBeGreaterThan(0); expect(Math.abs(c.gamma - p.gamma)).toBeLessThan(1e-12);
    expect(c.vega).toBeGreaterThan(0); expect(Math.abs(c.vega - p.vega)).toBeLessThan(1e-12);
  });
  it("Greeks agree with finite differences", () => {
    const [F, K, T, s, r] = [100, 102, 0.25, 0.3, 0.03];
    const g = black76("call", F, K, T, s, r)!;
    const h = 1e-4;
    const up = black76("call", F + h, K, T, s, r)!.price, dn = black76("call", F - h, K, T, s, r)!.price;
    expect(Math.abs(g.delta - (up - dn) / (2 * h))).toBeLessThan(1e-6);
    expect(Math.abs(g.gamma - (up - 2 * g.price + dn) / (h * h))).toBeLessThan(1e-4);
    const vegaFd = (black76("call", F, K, T, s + 0.01, r)!.price - black76("call", F, K, T, s - 0.01, r)!.price) / 2;
    expect(Math.abs(g.vega - vegaFd)).toBeLessThan(1e-3);
    const thetaFd = black76("call", F, K, T - 1 / 365, s, r)!.price - g.price;
    expect(Math.abs(g.theta - thetaFd)).toBeLessThan(2e-3);
    const rhoFd = (black76("call", F, K, T, s, r + 0.01)!.price - black76("call", F, K, T, s, r - 0.01)!.price) / 2;
    expect(Math.abs(g.rho - rhoFd)).toBeLessThan(1e-4);
  });
  it("refuses unusable inputs and unknown kinds", () => {
    expect(black76("call", 0, 100, 0.5, 0.3)).toBeNull();
    expect(black76("call", 100, -1, 0.5, 0.3)).toBeNull();
    expect(black76("call", 100, 100, 0, 0.3)).toBeNull();
    expect(black76("call", 100, 100, 0.5, 0)).toBeNull();
    expect(black76("call", NaN, 100, 0.5, 0.3)).toBeNull();
    expect(black76("call", 100, 100, 0.5, 0.3, Infinity)).toBeNull();
    expect(black76("straddle" as never, 100, 100, 0.5, 0.3)).toBeNull();
  });
});

describe("implied vol", () => {
  it.each([["call", 100, 100, 0.5, 0.3, 0.04], ["put", 80, 95, 0.1, 0.55, 0], ["call", 3, 2.5, 1, 0.8, 0.02]] as const)("round-trips %s", (kind, F, K, T, s, r) => {
    const price = black76(kind, F, K, T, s, r)!.price;
    expect(Math.abs(impliedVol(kind, price, F, K, T, r)! - s)).toBeLessThan(1e-6);
  });
  it("refuses prices outside the model", () => {
    expect(impliedVol("call", 0, 100, 100, 0.5)).toBeNull();
    expect(impliedVol("call", 1, 100, 90, 0.5)).toBeNull();
    expect(impliedVol("call", 150, 100, 90, 0.5)).toBeNull();
  });
});

describe("payoffs", () => {
  it("named structures have the expected expiry payoffs", () => {
    const cs = buildStrategy("call_spread", [100, 110], [4, 1.5]);
    expect(payoffAtExpiry(cs, 90)).toBe(-2.5); expect(payoffAtExpiry(cs, 120)).toBe(7.5); expect(payoffAtExpiry(cs, 105)).toBe(2.5);
    const st = buildStrategy("straddle", [100], [3, 3]);
    expect(payoffAtExpiry(st, 100)).toBe(-6); expect(payoffAtExpiry(st, 112)).toBe(6);
    const collar = buildStrategy("collar", [90, 110], [2, 2], 100);
    expect(payoffAtExpiry(collar, 60)).toBe(-10); expect(payoffAtExpiry(collar, 150)).toBe(10);
    const bf = buildStrategy("butterfly", [90, 100, 110], [12, 5, 1]);
    expect(payoffAtExpiry(bf, 100)).toBe(7); expect(payoffAtExpiry(bf, 80)).toBe(-3); expect(payoffAtExpiry(bf, 130)).toBe(-3);
    const rr = buildStrategy("risk_reversal", [90, 110], [1, 1]);
    expect(payoffAtExpiry(rr, 100)).toBe(0); expect(payoffAtExpiry(rr, 80)).toBe(-10);
    const cc = buildStrategy("covered_call", [0, 110], [2], 100);
    expect(payoffAtExpiry(cc, 130)).toBe(12); expect(payoffAtExpiry(cc, 90)).toBe(-8);
    expect(payoffAtExpiry(buildStrategy("short_future", [], [], 100), 95)).toBe(5);
  });
  it("every strategy builds with the declared counts", () => {
    for (const name of Object.keys(STRATEGIES)) {
      const nk = strategyStrikes(name);
      const legs = buildStrategy(name, nk ? [90, 100, 110].slice(0, Math.max(nk, 1)) : [], Array(strategyOptionLegs(name)).fill(1), 100);
      expect(legs.length).toBeGreaterThan(0);
      expect(legs.filter((l) => l.kind !== "future").length).toBe(strategyOptionLegs(name));
    }
    expect(() => buildStrategy("call_spread", [100], [1, 1])).toThrow();
    expect(() => buildStrategy("iron_condor", [1, 2, 3, 4], [1, 1, 1, 1])).toThrow();
  });
  it("breakevens and summary", () => {
    const legs = buildStrategy("straddle", [100], [3, 2]);
    const s = summarise(legs, 60, 140);
    expect(s.breakevens.map((b) => Math.round(b * 1e6) / 1e6)).toEqual([95, 105]);
    expect(s.netPremium).toBe(5); expect(s.maxLoss).toBe(-5); expect(s.maxGain).toBeNull();
    const spread = summarise(buildStrategy("call_spread", [100, 110], [4, 1.5]), 60, 140);
    expect(spread.maxGain).toBe(7.5); expect(spread.maxLoss).toBe(-2.5);
    expect(spread.breakevens.map((b) => Math.round(b * 1e6) / 1e6)).toEqual([102.5]);
    const { xs, ys } = payoffCurve(legs, 60, 140, 81);
    expect(xs).toContain(100); expect(xs.length).toBeGreaterThanOrEqual(81); expect(ys[xs.indexOf(100)]).toBe(-5);
    expect(breakevens(legs, 60, 140).length).toBe(2);
  });
});

describe("realised vol and expected move", () => {
  it("on a known series", () => {
    const closes: [string, number][] = [["d0", 100], ["d1", 101], ["d2", 99], ["d3", 102], ["d4", 100.5]];
    const rv = realisedVol(closes)!;
    const rets = [Math.log(101 / 100), Math.log(99 / 101), Math.log(102 / 99), Math.log(100.5 / 102)];
    const mean = rets.reduce((a, b) => a + b) / 4;
    const expectVol = Math.sqrt((rets.reduce((a, x) => a + (x - mean) ** 2, 0) / 3) * 252);
    expect(Math.abs(rv.vol - expectVol)).toBeLessThan(1e-12);
    expect(rv.nReturns).toBe(4); expect(rv.first).toBe("d0"); expect(rv.last).toBe("d4");
    expect(realisedVol(closes, 2)!.nReturns).toBe(2);
    expect(realisedVol(closes.slice(0, 2))).toBeNull();
  });
  it("skips a bad close without bridging", () => {
    const rv = realisedVol([["a", 100], ["b", 0], ["c", 110], ["d", 111], ["e", 112]])!;
    expect(rv.nReturns).toBe(2);
  });
  it("expected move", () => {
    expect(Math.abs(expectedMove(100, 0.3, 365)! - 30)).toBeLessThan(1e-12);
    expect(expectedMove(100, 0.3, 0)).toBe(0);
    expect(expectedMove(0, 0.3, 10)).toBeNull();
    expect(expectedMove(100, 0.3, -1)).toBeNull();
  });
});
