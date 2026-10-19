import { describe, expect, it } from "vitest";
import { carryPerMonth, crack321, dailyMove, eurMwhToUsdMmbtu, galToBbl, kbdToKtPerYear, lotsFor, tonneToBblGasoil, usdMmbtuToEurMwh, bblToTonneCrude } from "../src/conversions";

describe("conversions (ported constants from c-terminal drills)", () => {
  it("uses 42 gal/bbl, 7.33 and 7.45 bbl/t, 3.412 MMBtu/MWh, 252 days", () => {
    expect(galToBbl(2)).toBeCloseTo(84, 10);
    expect(bblToTonneCrude(100)).toBeCloseTo(733, 10);
    expect(tonneToBblGasoil(745)).toBeCloseTo(100, 10);
    expect(eurMwhToUsdMmbtu(34.12, 1.0)).toBeCloseTo(10, 10);
    expect(usdMmbtuToEurMwh(10, 1.0)).toBeCloseTo(34.12, 10);
    expect(kbdToKtPerYear(733)).toBeCloseTo(36500, 6);
    expect(crack321(2, 2.5, 70)).toBeCloseTo((2 * 84 + 105 - 210) / 3, 10);
    expect(dailyMove(100, 0.32)).toBeCloseTo(100 * 0.32 / Math.sqrt(252), 10);
    expect(carryPerMonth(60, 6, 0.4, 1.0)).toBeCloseTo(1.0 - 0.4 - 0.3, 10);
    expect(lotsFor(600000)).toBe(600);
  });
});
