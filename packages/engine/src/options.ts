/**
 * Options on futures: Black-76 price and Greeks, implied vol by bisection, expiry payoffs of multi-leg
 * structures, realised volatility. Ported from c-terminal's cterm/metrics/options.py with the same
 * conventions, re-implemented here (never imported).
 *
 * Conventions: F futures price, K strike, T years (calendar days / 365), r continuously compounded,
 * sigma annualised. Greeks: delta per 1.0 of F; gamma per 1.0 of F squared; vega per 1 vol point (0.01);
 * theta per calendar day; rho per 1 pp of r.
 */
const SQRT_2 = Math.SQRT2;
export const TRADING_DAYS = 252;
export const DAYS_PER_YEAR = 365;

/** erf via Abramowitz-Stegun 7.1.26 refined with a high-precision rational approximation (max error ~1e-12). */
export function erf(x: number): number {
  // W. J. Cody's rational Chebyshev approximation, as used in many numerical libraries.
  const ax = Math.abs(x);
  let r: number;
  if (ax < 0.5) {
    const t = x * x;
    const a = [3.16112374387056560e0, 1.13864154151050156e2, 3.77485237685302021e2, 3.20937758913846947e3, 1.85777706184603153e-1];
    const b = [2.36012909523441209e1, 2.44024637934444173e2, 1.28261652607737228e3, 2.84423683343917062e3];
    let num = a[4] * t;
    let den = t;
    for (let i = 0; i < 3; i++) {
      num = (num + a[i]) * t;
      den = (den + b[i]) * t;
    }
    return (x * (num + a[3])) / (den + b[3]);
  } else if (ax <= 4) {
    const c = [5.64188496988670089e-1, 8.88314979438837594e0, 6.61191906371416295e1, 2.98635138197400131e2, 8.81952221241769090e2, 1.71204761263407058e3, 2.05107837782607147e3, 1.23033935479799725e3, 2.15311535474403846e-8];
    const d = [1.57449261107098347e1, 1.17693950891312499e2, 5.37181101862009858e2, 1.62138957456669019e3, 3.29079923573345963e3, 4.36261909014324716e3, 3.43936767414372164e3, 1.23033935480374942e3];
    let num = c[8] * ax;
    let den = ax;
    for (let i = 0; i < 7; i++) {
      num = (num + c[i]) * ax;
      den = (den + d[i]) * ax;
    }
    r = (num + c[7]) / (den + d[7]);
    const xsq = Math.floor(ax * 16) / 16;
    const del = (ax - xsq) * (ax + xsq);
    r = Math.exp(-xsq * xsq) * Math.exp(-del) * r;
    r = 1 - r;
  } else {
    const p = [3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1, 1.60837851487422766e-2, 6.58749161529837803e-4, 1.63153871373020978e-2];
    const q = [2.56852019228982242e0, 1.87295284992346725e0, 5.27905102951428412e-1, 6.05183413124413191e-2, 2.33520497626869185e-3];
    const t = 1 / (ax * ax);
    let num = p[5] * t;
    let den = t;
    for (let i = 0; i < 4; i++) {
      num = (num + p[i]) * t;
      den = (den + q[i]) * t;
    }
    r = (t * (num + p[4])) / (den + q[4]);
    r = (1 / Math.sqrt(Math.PI) - r) / ax;
    const xsq = Math.floor(ax * 16) / 16;
    const del = (ax - xsq) * (ax + xsq);
    r = Math.exp(-xsq * xsq) * Math.exp(-del) * r;
    r = 1 - r;
  }
  return x < 0 ? -r : r;
}

export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / SQRT_2));
}
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function finitePositive(...xs: number[]): boolean {
  return xs.every((x) => typeof x === "number" && Number.isFinite(x) && x > 0);
}

export interface Greeks {
  price: number;
  delta: number;
  gamma: number;
  vega: number; // per vol point
  theta: number; // per calendar day
  rho: number; // per percentage point of r
  d1: number;
  d2: number;
}

export type OptionKind = "call" | "put";

/** Black-76 value and Greeks of a European option on a futures price F. null if an input is not a positive finite number. */
export function black76(kind: OptionKind, F: number, K: number, T: number, sigma: number, r = 0): Greeks | null {
  if ((kind !== "call" && kind !== "put") || !finitePositive(F, K, T, sigma) || !Number.isFinite(r)) return null;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const disc = Math.exp(-r * T);
  const nd1 = normCdf(d1);
  const nd2 = normCdf(d2);
  const pdf1 = normPdf(d1);
  let price: number;
  let delta: number;
  let thetaYear: number;
  if (kind === "call") {
    price = disc * (F * nd1 - K * nd2);
    delta = disc * nd1;
    thetaYear = (-disc * F * pdf1 * sigma) / (2 * sqrtT) + r * disc * (F * nd1 - K * nd2);
  } else {
    price = disc * (K * normCdf(-d2) - F * normCdf(-d1));
    delta = -disc * normCdf(-d1);
    thetaYear = (-disc * F * pdf1 * sigma) / (2 * sqrtT) + r * disc * (K * normCdf(-d2) - F * normCdf(-d1));
  }
  const gamma = (disc * pdf1) / (F * sigma * sqrtT);
  const vega = (disc * F * pdf1 * sqrtT) / 100;
  const rho = (-T * price) / 100;
  return { price, delta, gamma, vega, theta: thetaYear / DAYS_PER_YEAR, rho, d1, d2 };
}

/** The sigma at which black76 returns `price`, by bisection. null when the price is outside the model's range. */
export function impliedVol(kind: OptionKind, price: number, F: number, K: number, T: number, r = 0, lo = 0.001, hi = 5.0, tol = 1e-8, maxIter = 200): number | null {
  if ((kind !== "call" && kind !== "put") || !finitePositive(F, K, T) || !Number.isFinite(price)) return null;
  const disc = Math.exp(-r * T);
  const intrinsic = disc * Math.max(0, kind === "call" ? F - K : K - F);
  const upper = disc * (kind === "call" ? F : K);
  if (price < intrinsic - 1e-12 || price > upper + 1e-12 || price <= 0) return null;
  const fLo = black76(kind, F, K, T, lo, r)!.price - price;
  const fHi = black76(kind, F, K, T, hi, r)!.price - price;
  if (fLo > 0 || fHi < 0) return null;
  let a = lo;
  let b = hi;
  for (let i = 0; i < maxIter; i++) {
    const mid = 0.5 * (a + b);
    const fMid = black76(kind, F, K, T, mid, r)!.price - price;
    if (Math.abs(fMid) < tol || b - a < tol) return mid;
    if (fMid > 0) b = mid;
    else a = mid;
  }
  return 0.5 * (a + b);
}

export function yearsToExpiry(days: number): number {
  return Math.max(days, 0) / DAYS_PER_YEAR;
}

// ---------------------------------------------------------------- structures
export interface Leg {
  kind: "call" | "put" | "future";
  qty: number; // positive = long
  strike: number; // strike, or entry price of a future
  premium: number; // option premium per unit, ignored for a future
}

export function legPayoff(leg: Leg, S: number): number {
  if (leg.kind === "future") return S - leg.strike;
  if (leg.kind === "call") return Math.max(0, S - leg.strike) - leg.premium;
  return Math.max(0, leg.strike - S) - leg.premium;
}
export function payoffAtExpiry(legs: Leg[], S: number): number {
  return legs.reduce((acc, leg) => acc + leg.qty * legPayoff(leg, S), 0);
}
export function payoffCurve(legs: Leg[], lo: number, hi: number, n = 241): { xs: number[]; ys: number[] } {
  if (n < 2 || !(lo < hi)) throw new Error("payoffCurve needs lo < hi and n >= 2");
  const step = (hi - lo) / (n - 1);
  const grid = new Set<number>();
  for (let i = 0; i < n; i++) grid.add(Number((lo + i * step).toFixed(10)));
  for (const leg of legs) if (lo <= leg.strike && leg.strike <= hi) grid.add(Number(leg.strike.toFixed(10)));
  const xs = [...grid].sort((a, b) => a - b);
  return { xs, ys: xs.map((x) => payoffAtExpiry(legs, x)) };
}
export function breakevens(legs: Leg[], lo: number, hi: number, n = 2001): number[] {
  const { xs, ys } = payoffCurve(legs, lo, hi, n);
  const out: number[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i], y0 = ys[i], x1 = xs[i + 1], y1 = ys[i + 1];
    if (y0 === 0 && (out.length === 0 || Math.abs(out[out.length - 1] - x0) > 1e-9)) out.push(x0);
    else if ((y0 < 0 && 0 < y1) || (y1 < 0 && 0 < y0)) out.push(x0 + ((x1 - x0) * -y0) / (y1 - y0));
  }
  return out;
}
export interface PayoffSummary { maxGain: number | null; maxLoss: number | null; netPremium: number; breakevens: number[] }
export function summarise(legs: Leg[], lo: number, hi: number): PayoffSummary {
  const { ys } = payoffCurve(legs, lo, hi);
  const net = legs.filter((l) => l.kind !== "future").reduce((a, l) => a + l.qty * l.premium, 0);
  const slopeLo = ys[1] - ys[0];
  const slopeHi = ys[ys.length - 1] - ys[ys.length - 2];
  let maxGain: number | null = Math.max(...ys);
  let maxLoss: number | null = Math.min(...ys);
  if (slopeLo < -1e-12 || slopeHi > 1e-12) maxGain = null;
  if (slopeLo > 1e-12 || slopeHi < -1e-12) maxLoss = null;
  return { maxGain, maxLoss, netPremium: net, breakevens: breakevens(legs, lo, hi) };
}

export const STRATEGIES: Record<string, string> = {
  long_future: "Long future", short_future: "Short future", long_call: "Long call", long_put: "Long put", short_call: "Short call", short_put: "Short put",
  call_spread: "Call spread (long K1 call, short K2 call)", put_spread: "Put spread (long K2 put, short K1 put)", straddle: "Long straddle (call + put at K1)",
  strangle: "Long strangle (put at K1, call at K2)", collar: "Producer collar (long future, long K1 put, short K2 call)",
  risk_reversal: "Risk reversal (long K2 call, short K1 put)", butterfly: "Call butterfly (long K1, short 2x K2, long K3)", covered_call: "Covered call (long future, short K2 call)",
};
const OPTION_LEGS: Record<string, number> = { long_future: 0, short_future: 0, long_call: 1, long_put: 1, short_call: 1, short_put: 1, call_spread: 2, put_spread: 2, straddle: 2, strangle: 2, collar: 2, risk_reversal: 2, butterfly: 3, covered_call: 1 };
const STRIKES: Record<string, number> = { long_future: 0, short_future: 0, long_call: 1, long_put: 1, short_call: 1, short_put: 1, call_spread: 2, put_spread: 2, straddle: 1, strangle: 2, collar: 2, risk_reversal: 2, butterfly: 3, covered_call: 2 };
export function strategyOptionLegs(name: string): number { return OPTION_LEGS[name]; }
export function strategyStrikes(name: string): number { return STRIKES[name]; }

export function buildStrategy(name: string, strikes: number[], premiums: number[], futurePrice = 0): Leg[] {
  const k = strikes, p = premiums;
  const need = (nk: number, np: number) => { if (k.length < nk || p.length < np) throw new Error(`${name} needs ${nk} strike(s) and ${np} premium(s)`); };
  const L = (kind: Leg["kind"], qty: number, strike: number, premium = 0): Leg => ({ kind, qty, strike, premium });
  switch (name) {
    case "long_future": return [L("future", 1, futurePrice)];
    case "short_future": return [L("future", -1, futurePrice)];
    case "long_call": need(1, 1); return [L("call", 1, k[0], p[0])];
    case "long_put": need(1, 1); return [L("put", 1, k[0], p[0])];
    case "short_call": need(1, 1); return [L("call", -1, k[0], p[0])];
    case "short_put": need(1, 1); return [L("put", -1, k[0], p[0])];
    case "call_spread": need(2, 2); return [L("call", 1, k[0], p[0]), L("call", -1, k[1], p[1])];
    case "put_spread": need(2, 2); return [L("put", 1, k[1], p[0]), L("put", -1, k[0], p[1])];
    case "straddle": need(1, 2); return [L("call", 1, k[0], p[0]), L("put", 1, k[0], p[1])];
    case "strangle": need(2, 2); return [L("put", 1, k[0], p[0]), L("call", 1, k[1], p[1])];
    case "collar": need(2, 2); return [L("future", 1, futurePrice), L("put", 1, k[0], p[0]), L("call", -1, k[1], p[1])];
    case "risk_reversal": need(2, 2); return [L("call", 1, k[1], p[0]), L("put", -1, k[0], p[1])];
    case "butterfly": need(3, 3); return [L("call", 1, k[0], p[0]), L("call", -2, k[1], p[1]), L("call", 1, k[2], p[2])];
    case "covered_call": need(2, 1); return [L("future", 1, futurePrice), L("call", -1, k[1], p[0])];
    default: throw new Error(`unknown strategy ${name}`);
  }
}

// ---------------------------------------------------------------- realised volatility
export interface RealisedVol { vol: number; nReturns: number; first: unknown; last: unknown }
export function realisedVol(closes: [unknown, number][], window?: number): RealisedVol | null {
  const rets: number[] = [];
  const dates: unknown[] = [];
  let prev: [unknown, number] | null = null;
  for (const [d, c] of closes) {
    const ok = typeof c === "number" && Number.isFinite(c) && c > 0;
    if (ok && prev !== null) { rets.push(Math.log(c / prev[1])); dates.push(d); }
    prev = ok ? [d, c] : null;
  }
  let r = rets, ds = dates;
  if (window !== undefined) { r = rets.slice(-window); ds = dates.slice(-window); }
  const n = r.length;
  if (n < 2) return null;
  const mean = r.reduce((a, b) => a + b, 0) / n;
  const variance = r.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1);
  const firstIdx = closes.length - n - 1;
  return { vol: Math.sqrt(variance * TRADING_DAYS), nReturns: n, first: window !== undefined ? closes[Math.max(firstIdx, 0)][0] : closes[0][0], last: ds[ds.length - 1] };
}
export function expectedMove(F: number, sigma: number, days: number): number | null {
  if (!finitePositive(F, sigma) || !Number.isFinite(days) || days < 0) return null;
  return F * sigma * Math.sqrt(days / DAYS_PER_YEAR);
}
