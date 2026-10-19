import { describe, expect, it } from "vitest";
import { historicalVar } from "../src/risk";

describe("historical VaR (ported hand case from c-terminal)", () => {
  const closes = [100];
  for (let i = 0; i < 40; i++) closes.push(closes[closes.length - 1] * Math.exp(i % 2 === 0 ? 0.01 : -0.012));
  it("a long loses on the -1.2% days", () => {
    const out = historicalVar({ BRENT: 1000 }, { BRENT: 100 }, { BRENT: closes }, [0.95], 40);
    expect(out.length).toBe(1);
    const v = out[0];
    expect(v.days).toBe(40); expect(v.instruments).toEqual(["BRENT"]); expect(v.leftOut).toEqual([]);
    expect(Math.abs(v.loss - 1000 * 100 * 0.012)).toBeLessThan(1e-9);
    expect(Math.abs(v.worst - v.loss)).toBeLessThan(1e-9);
  });
  it("a short loses on the +1% days", () => {
    const v = historicalVar({ BRENT: -1000 }, { BRENT: 100 }, { BRENT: closes }, [0.95], 40)[0];
    expect(Math.abs(v.loss - 1000 * 100 * 0.01)).toBeLessThan(1e-9);
  });
  it("names what it left out and refuses thin histories", () => {
    expect(historicalVar({ BRENT: 1000, HH: 5 }, { BRENT: 100, HH: 3 }, { BRENT: closes }, [0.95], 40)[0].leftOut).toEqual(["HH"]);
    expect(historicalVar({ HH: 5 }, { HH: 3 }, {}, [0.95], 40)).toEqual([]);
    expect(historicalVar({ BRENT: 1 }, { BRENT: 100 }, { BRENT: closes.slice(0, 10) })).toEqual([]);
  });
});
