/**
 * The game calendar: one tick is one simulated hour. Weekends and stylised holidays are closed for prices.
 * Expiries are shaped like the real ones (section 4): Brent on the last business day of the second month
 * before delivery; WTI three business days before the 25th of the month before delivery; products on the
 * last business day of the month before delivery; Henry Hub three business days before the delivery month;
 * TTF two business days before the delivery month.
 */
import { CLOCK, INSTRUMENTS, type InstrumentId } from "./refdata";

export const HOURS_PER_DAY = 24;
const MS_PER_DAY = 86400000;

export function parseDate(iso: string): number {
  // days since epoch (UTC), integer
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function isoOfDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function dayOfTick(startDay: number, tick: number): number {
  return startDay + Math.floor(tick / HOURS_PER_DAY);
}
export function hourOfTick(tick: number): number {
  return ((tick % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
}
/** 0 = Sunday ... 6 = Saturday */
export function weekday(day: number): number {
  return ((day + 4) % 7 + 7) % 7; // 1970-01-01 was a Thursday
}
export function isWeekend(day: number): boolean {
  const w = weekday(day);
  return w === 0 || w === 6;
}
export function isHoliday(day: number): boolean {
  const iso = isoOfDay(day).slice(5);
  return CLOCK.holidays.value.includes(iso);
}
export function isBusinessDay(day: number): boolean {
  return !isWeekend(day) && !isHoliday(day);
}
export function addBusinessDays(day: number, n: number): number {
  let d = day;
  let left = Math.abs(n);
  const step = n >= 0 ? 1 : -1;
  while (left > 0) {
    d += step;
    if (isBusinessDay(d)) left -= 1;
  }
  return d;
}
export function lastBusinessDayOfMonth(year: number, month1: number): number {
  const firstNext = Math.floor(Date.UTC(month1 === 12 ? year + 1 : year, month1 === 12 ? 0 : month1, 1) / MS_PER_DAY);
  let d = firstNext - 1;
  while (!isBusinessDay(d)) d -= 1;
  return d;
}
export function monthStart(year: number, month1: number): number {
  return Math.floor(Date.UTC(year, month1 - 1, 1) / MS_PER_DAY);
}
export function ymOf(day: number): { year: number; month: number } {
  const dt = new Date(day * MS_PER_DAY);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1 };
}
export function addMonths(year: number, month1: number, n: number): { year: number; month: number } {
  const idx = (year * 12 + (month1 - 1)) + n;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}
export function monthKey(year: number, month1: number): string {
  return `${year}-${String(month1).padStart(2, "0")}`;
}
export function parseMonthKey(key: string): { year: number; month: number } {
  const [y, m] = key.split("-").map(Number);
  return { year: y, month: m };
}
const MONTH_CODES = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"];
export function contractCode(inst: InstrumentId, key: string): string {
  const { year, month } = parseMonthKey(key);
  const prefix = { BRENT: "BRN", WTI: "CL", RBOB: "RB", ULSD: "HO", HH: "NG", TTF: "TFM" }[inst];
  return `${prefix}${MONTH_CODES[month - 1]}${String(year % 100).padStart(2, "0")}`;
}
export function monthLabel(key: string): string {
  const { year, month } = parseMonthKey(key);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[month - 1]}-${String(year % 100).padStart(2, "0")}`;
}

/** Last trading day (as a day number) of the contract for delivery month `key`. */
export function expiryDay(inst: InstrumentId, key: string): number {
  const { year, month } = parseMonthKey(key);
  const rule = INSTRUMENTS[inst].expiryRule;
  switch (rule) {
    case "brent": {
      const m = addMonths(year, month, -2);
      return lastBusinessDayOfMonth(m.year, m.month);
    }
    case "wti": {
      const m = addMonths(year, month, -1);
      const d25 = monthStart(m.year, m.month) + 24;
      let d = d25;
      if (!isBusinessDay(d)) { while (!isBusinessDay(d)) d -= 1; }
      return addBusinessDays(d, -3);
    }
    case "products": {
      const m = addMonths(year, month, -1);
      return lastBusinessDayOfMonth(m.year, m.month);
    }
    case "hh":
      return addBusinessDays(monthStart(year, month), -3);
    case "ttf":
      return addBusinessDays(monthStart(year, month), -2);
  }
}

/** The twelve listed delivery months of `inst` as seen on `day`: the first is the earliest contract not yet expired. */
export function listedMonths(inst: InstrumentId, day: number, count = 12): string[] {
  const { year, month } = ymOf(day);
  const out: string[] = [];
  let k = 0;
  while (out.length < count && k < 30) {
    const m = addMonths(year, month, k);
    const key = monthKey(m.year, m.month);
    if (expiryDay(inst, key) >= day) out.push(key);
    k += 1;
  }
  return out;
}

/** Months (continuous) from `day` to the first day of the delivery month. */
export function tauMonths(key: string, day: number): number {
  const { year, month } = parseMonthKey(key);
  return Math.max(0, (monthStart(year, month) - day) / 30.4375);
}

export function season(day: number): { summer: number; winter: number } {
  // smooth seasonal weights in [0,1]: summer peaks at July, winter at January
  const dt = new Date(day * MS_PER_DAY);
  const doy = (Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()) - Date.UTC(dt.getUTCFullYear(), 0, 1)) / MS_PER_DAY;
  const phase = (2 * Math.PI * (doy - 15)) / 365.25; // cos peaks mid-January
  const winter = (1 + Math.cos(phase)) / 2;
  return { summer: 1 - winter, winter };
}

export function isSettleTick(startDay: number, tick: number): boolean {
  return hourOfTick(tick) === CLOCK.settleHour.value && isBusinessDay(dayOfTick(startDay, tick));
}
export function isTradingTick(startDay: number, tick: number): boolean {
  return isBusinessDay(dayOfTick(startDay, tick));
}
export function nextSettleTick(startDay: number, tick: number): number {
  let t = tick + 1;
  while (!isSettleTick(startDay, t)) t += 1;
  return t;
}
export function formatClock(startDay: number, tick: number): string {
  const day = dayOfTick(startDay, tick);
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${names[weekday(day)]} ${isoOfDay(day)} ${String(hourOfTick(tick)).padStart(2, "0")}:00`;
}
