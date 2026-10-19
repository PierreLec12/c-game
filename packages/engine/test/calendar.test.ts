import { describe, expect, it } from "vitest";
import { addBusinessDays, expiryDay, isBusinessDay, isoOfDay, listedMonths, parseDate, tauMonths, weekday } from "../src/calendar";

describe("calendar", () => {
  it("knows weekdays and holidays", () => {
    const d = parseDate("2027-01-04");
    expect(weekday(d)).toBe(1); // Monday
    expect(isBusinessDay(d)).toBe(true);
    expect(isBusinessDay(parseDate("2027-01-02"))).toBe(false); // Saturday
    expect(isBusinessDay(parseDate("2027-01-01"))).toBe(false); // holiday
    expect(isoOfDay(addBusinessDays(d, 5))).toBe("2027-01-11");
  });
  it("shapes expiries like the real ones", () => {
    expect(isoOfDay(expiryDay("BRENT", "2027-03"))).toBe("2027-01-29"); // last business day of January
    expect(isoOfDay(expiryDay("WTI", "2027-02"))).toBe("2027-01-20"); // 3 business days before the 25th
    expect(isoOfDay(expiryDay("RBOB", "2027-02"))).toBe("2027-01-29");
    expect(isoOfDay(expiryDay("HH", "2027-02"))).toBe("2027-01-27"); // 3 business days before Feb 1
    expect(isoOfDay(expiryDay("TTF", "2027-02"))).toBe("2027-01-28");
  });
  it("lists twelve months starting with the first unexpired contract", () => {
    const d = parseDate("2027-01-04");
    const brent = listedMonths("BRENT", d);
    expect(brent.length).toBe(12);
    expect(brent[0]).toBe("2027-03");
    expect(listedMonths("WTI", d)[0]).toBe("2027-02");
    expect(listedMonths("BRENT", parseDate("2027-01-30"))[0]).toBe("2027-04");
    expect(tauMonths("2027-03", d)).toBeGreaterThan(1.8);
  });
});
