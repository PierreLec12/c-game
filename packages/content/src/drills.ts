/**
 * Mental-arithmetic drills with answers computed by code (ported from c-terminal cterm/prep/drills.py).
 * Every figure is invented inside a plausible range; the prompt states every constant the answer needs.
 */
import { makeRng, type DrillQuestion, type Stream, BBL_PER_T_CRUDE, BBL_PER_T_GASOIL, GAL_PER_BBL, MMBTU_PER_MWH, TRADING_DAYS_PER_YEAR } from "@desk/engine";

type Spec = Omit<DrillQuestion, "id" | "type">;

const step = (s: Stream, lo: number, hi: number, st: number): number => {
  const n = Math.round((hi - lo) / st);
  const v = lo + st * s.int(0, n);
  const d = (st.toString().split(".")[1] ?? "").length;
  return Number(v.toFixed(d));
};
const tol = (answer: number, abs: number, rel = 0): number => Math.max(abs, rel * Math.abs(answer));
const f2 = (x: number) => x.toFixed(2);

const SIZES: Record<string, [number, string, string]> = { Brent: [1000, "bbl", "$/bbl"], WTI: [1000, "bbl", "$/bbl"], RBOB: [42000, "gal", "$/gal"], ULSD: [42000, "gal", "$/gal"], "Henry Hub": [10000, "MMBtu", "$/MMBtu"] };
const PRICES: Record<string, [number, number, number]> = { Brent: [55, 130, 0.05], WTI: [50, 125, 0.05], RBOB: [1.5, 4, 0.01], ULSD: [1.6, 4.5, 0.01], "Henry Hub": [1.8, 9, 0.01] };
const MOVES: Record<string, [number, number, number]> = { Brent: [0.1, 6, 0.05], WTI: [0.1, 6, 0.05], RBOB: [0.01, 0.15, 0.01], ULSD: [0.01, 0.15, 0.01], "Henry Hub": [0.05, 0.6, 0.01] };

export const GENERATORS: Record<string, { label: string; make: (s: Stream) => Spec }> = {
  spread: { label: "Spread", make: (s) => { const d = step(s, 0.5, 8, 0.05); const brent = step(s, 60, 130, 0.05); const wti = Number((brent - d).toFixed(2)); return { prompt: `Brent ${f2(brent)}, WTI ${f2(wti)} $/bbl. What is the Brent-WTI spread?`, answer: Number(d.toFixed(2)), unit: "$/bbl", decimals: 2, tolerance: 0.005, working: `${f2(brent)} - ${f2(wti)} = ${f2(d)}; Brent at a premium.` }; } },
  pnl: { label: "Futures P&L", make: (s) => { const inst = s.pick(Object.keys(SIZES)); const [size, su, pu] = SIZES[inst]; const lots = s.pick([5, 10, 20, 25, 50, 75, 100, 150, 200]); const entry = step(s, ...PRICES[inst]); const move = step(s, ...MOVES[inst]) * s.pick([-1, 1]); const exit = Number((entry + move).toFixed(2)); const side = s.pick(["long", "short"]); const sign = side === "long" ? 1 : -1; const pnl = Math.round(sign * lots * size * (exit - entry)); return { prompt: `You are ${side} ${lots} lots of ${inst} (1 lot = ${size.toLocaleString()} ${su}) from ${f2(entry)} ${pu}; the market is ${f2(exit)}. P&L in dollars?`, answer: pnl, unit: "$", decimals: 0, tolerance: 0.5, working: `${sign > 0 ? "+" : "-"}${lots} x ${size.toLocaleString()} x (${f2(exit)} - ${f2(entry)}) = ${pnl.toLocaleString()}` }; } },
  pct: { label: "Percent change", make: (s) => { const a = step(s, 20, 150, 0.5); const b = Number((a * (1 + s.pick([-1, 1]) * step(s, 0.02, 0.35, 0.005))).toFixed(2)); const pct = Number(((b / a - 1) * 100).toFixed(1)); return { prompt: `A price goes from ${f2(a)} to ${f2(b)}. Percentage change (one decimal)?`, answer: pct, unit: "%", decimals: 1, tolerance: 0.06, working: `(${f2(b)} / ${f2(a)} - 1) x 100 = ${pct.toFixed(1)} %` }; } },
  gal_bbl: { label: "$/gal to $/bbl", make: (s) => { const p = step(s, 1.2, 4.2, 0.01); const ans = Number((p * GAL_PER_BBL).toFixed(2)); const prod = s.pick(["RBOB", "ULSD"]); return { prompt: `${prod} is ${f2(p)} $/gal. Price in $/bbl (42 gallons per barrel)?`, answer: ans, unit: "$/bbl", decimals: 2, tolerance: 0.005, working: `${f2(p)} x 42 = ${f2(ans)}` }; } },
  mmbtu_mwh: { label: "$/MMBtu and EUR/MWh", make: (s) => { const fx = step(s, 0.95, 1.25, 0.01); if (s.chance(0.5)) { const eur = step(s, 18, 90, 0.25); const ans = Number(((eur * fx) / MMBTU_PER_MWH).toFixed(2)); return { prompt: `TTF is ${f2(eur)} EUR/MWh and EUR/USD is ${f2(fx)}. TTF in $/MMBtu (3.412 MMBtu per MWh)?`, answer: ans, unit: "$/MMBtu", decimals: 2, tolerance: tol(ans, 0.01, 0.005), working: `${f2(eur)} x ${f2(fx)} / 3.412 = ${f2(ans)}` }; } const usd = step(s, 5, 30, 0.05); const ans = Number(((usd * MMBTU_PER_MWH) / fx).toFixed(2)); return { prompt: `JKM is ${f2(usd)} $/MMBtu and EUR/USD is ${f2(fx)}. The same price in EUR/MWh (3.412 MMBtu per MWh)?`, answer: ans, unit: "EUR/MWh", decimals: 2, tolerance: tol(ans, 0.01, 0.005), working: `${f2(usd)} x 3.412 / ${f2(fx)} = ${f2(ans)}` }; } },
  tonne_bbl: { label: "$/t and $/bbl", make: (s) => { if (s.chance(0.5)) { const t = step(s, 450, 1200, 0.25); const ans = Number((t / BBL_PER_T_GASOIL).toFixed(2)); return { prompt: `ICE gasoil is ${f2(t)} $/t. Price in $/bbl (7.45 bbl per tonne)?`, answer: ans, unit: "$/bbl", decimals: 2, tolerance: tol(ans, 0.01, 0.005), working: `${f2(t)} / 7.45 = ${f2(ans)}` }; } const b = step(s, 50, 130, 0.05); const ans = Math.round(b * BBL_PER_T_CRUDE); return { prompt: `Crude is ${f2(b)} $/bbl. Price in $/t at the world-average 7.33 bbl per tonne (nearest dollar)?`, answer: ans, unit: "$/t", decimals: 0, tolerance: tol(ans, 0.5, 0.005), working: `${f2(b)} x 7.33 = ${ans.toLocaleString()}` }; } },
  kbd_mty: { label: "kb/d to kt/y", make: (s) => { const kbd = step(s, 20, 2000, 10); const ans = Math.round((kbd * 365) / BBL_PER_T_CRUDE); return { prompt: `A field produces ${kbd.toLocaleString()} kb/d. Thousand tonnes a year at 7.33 bbl/t (the '50 kt per kb/d' rule is close enough)?`, answer: ans, unit: "kt/y", decimals: 0, tolerance: tol(ans, 1, 0.01), working: `${kbd.toLocaleString()} x 365 / 7.33 = ${ans.toLocaleString()} kt/y (about ${(kbd * 50).toLocaleString()} with the rule)` }; } },
  crack321: { label: "3-2-1 crack", make: (s) => { const rb = step(s, 1.6, 3.6, 0.01); const ho = step(s, 1.8, 4, 0.01); const crack = step(s, 2, 40, 0.5); const cl = Number((Math.round(((2 * rb * 42 + ho * 42) / 3 - crack) / 0.05) * 0.05).toFixed(2)); const ans = Number(((2 * rb * 42 + ho * 42 - 3 * cl) / 3).toFixed(2)); return { prompt: `RBOB ${f2(rb)} $/gal, ULSD ${f2(ho)} $/gal, WTI ${f2(cl)} $/bbl. The 3-2-1 crack in $/bbl?`, answer: ans, unit: "$/bbl", decimals: 2, tolerance: tol(ans, 0.01, 0.002), working: `(2 x ${f2(rb * 42)} + ${f2(ho * 42)} - 3 x ${f2(cl)}) / 3 = ${f2(ans)}` }; } },
  carry: { label: "Storage carry", make: (s) => { const p = step(s, 50, 120, 0.5); const r = step(s, 2, 8, 0.25); const st = step(s, 0.2, 1, 0.05); const c = step(s, 0.3, 2.5, 0.05); const fin = (p * r) / 100 / 12; const ans = Number((c - st - fin).toFixed(2)); return { prompt: `M1-M2 contango is ${f2(c)} $/bbl, storage costs ${f2(st)} $/bbl per month, crude is ${f2(p)} $/bbl and money costs ${f2(r)} % a year. Carry profit per barrel per month (two decimals)?`, answer: ans, unit: "$/bbl", decimals: 2, tolerance: 0.015, working: `financing ${f2(p)} x ${f2(r)} % / 12 = ${f2(fin)}; ${f2(c)} - ${f2(st)} - ${f2(fin)} = ${f2(ans)}` }; } },
  daily_move: { label: "One-sigma daily move", make: (s) => { const vol = step(s, 15, 80, 1); const p = step(s, 40, 130, 0.5); const ans = Number(((p * vol) / 100 / Math.sqrt(TRADING_DAYS_PER_YEAR)).toFixed(2)); return { prompt: `Implied vol ${vol.toFixed(0)} %, price ${f2(p)}. One-standard-deviation daily move (252 trading days; dividing the vol by 16 is accepted)?`, answer: ans, unit: "$", decimals: 2, tolerance: tol(ans, 0.01, 0.015), working: `${f2(p)} x ${vol.toFixed(0)} % / sqrt(252) = ${f2(ans)}` }; } },
  hedge_lots: { label: "Hedge lots", make: (s) => { const bpd = 5000 * s.int(2, 60); const days = s.int(28, 31); const ans = (bpd * days) / 1000; return { prompt: `A refinery makes ${bpd.toLocaleString()} b/d of diesel. ULSD lots (1 lot = 1,000 bbl) to hedge ${days} days of output?`, answer: ans, unit: "lots", decimals: 0, tolerance: 0, working: `${bpd.toLocaleString()} x ${days} / 1,000 = ${ans.toLocaleString()}` }; } },
  ttf_pnl: { label: "TTF P&L", make: (s) => { const mwh = 1000 * s.int(5, 200); const px = step(s, 15, 90, 0.5); const move = step(s, 0.5, 8, 0.25) * s.pick([-1, 1]); const side = s.pick(["long", "short"]); const sign = side === "long" ? 1 : -1; const ans = Math.round(sign * mwh * move); return { prompt: `You are ${side} ${mwh.toLocaleString()} MWh of TTF from ${f2(px)} EUR/MWh; the market is ${f2(px + move)}. P&L in EUR?`, answer: ans, unit: "EUR", decimals: 0, tolerance: 0.5, working: `${sign > 0 ? "+" : "-"}${mwh.toLocaleString()} x (${f2(px + move)} - ${f2(px)}) = ${ans.toLocaleString()}` }; } },
  freight: { label: "Worldscale to $/bbl", make: (s) => { const flat = step(s, 15, 60, 0.25); const ws = step(s, 30, 220, 2.5); const bpt = s.pick([7.33, 7.5, 7.6]); const ans = Number(((flat * ws) / 100 / bpt).toFixed(2)); return { prompt: `Worldscale flat rate ${f2(flat)} $/t, fixture at WS ${ws.toFixed(1)}, crude at ${bpt} bbl/t. Freight in $/bbl?`, answer: ans, unit: "$/bbl", decimals: 2, tolerance: tol(ans, 0.01, 0.005), working: `${f2(flat)} x ${ws.toFixed(1)} / 100 = ${f2((flat * ws) / 100)} $/t; / ${bpt} = ${f2(ans)} $/bbl` }; } },
  landed: { label: "Landed cost and arb", make: (s) => { const fob = step(s, 50, 120, 0.05); const fr = step(s, 1, 6, 0.05); const ins = step(s, 0.05, 0.3, 0.01); const fin = step(s, 0.1, 0.6, 0.01); const margin = step(s, -1.5, 2, 0.05); const cif = Number((fob + fr + ins + fin + margin).toFixed(2)); const ans = Number((cif - (fob + fr + ins + fin)).toFixed(2)); return { prompt: `FOB ${f2(fob)} $/bbl, freight ${f2(fr)}, insurance ${f2(ins)}, financing and losses ${f2(fin)}; the CIF market is ${f2(cif)}. Arb margin (CIF minus landed cost; negative if closed)?`, answer: ans, unit: "$/bbl", decimals: 2, tolerance: 0.015, working: `landed ${f2(fob)} + ${f2(fr)} + ${f2(ins)} + ${f2(fin)} = ${f2(fob + fr + ins + fin)}; ${f2(cif)} - that = ${f2(ans)}` }; } },
  straddle: { label: "ATM straddle", make: (s) => { const f = step(s, 40, 130, 0.5); const vol = step(s, 20, 90, 1); const months = s.int(1, 12); const ans = Number((0.8 * (vol / 100) * Math.sqrt(months / 12) * f).toFixed(1)); return { prompt: `At-the-money straddle on a future at ${f2(f)}, vol ${vol.toFixed(0)} %, ${months} month${months > 1 ? "s" : ""} to expiry. Rough price with 0.8 x vol x sqrt(T) x F (one decimal)?`, answer: ans, unit: "$", decimals: 1, tolerance: tol(ans, 0.1, 0.02), working: `0.8 x ${(vol / 100).toFixed(2)} x sqrt(${months}/12) x ${f2(f)} = ${ans.toFixed(1)}` }; } },
};

export function drillSet(seed: number, types: string[], salt = "drills"): DrillQuestion[] {
  const s = makeRng(seed).stream(salt, 0);
  return types.map((t, i) => ({ id: `drill.${t}.${i}`, type: t, ...GENERATORS[t].make(s) }));
}

export function checkDrill(d: DrillQuestion, answer: number): boolean {
  return Math.abs(answer - d.answer) <= d.tolerance + 1e-9;
}

/** '-300,000', '$ 1,234.5', '(300)', '-300k', '+3.2 %', '2.52 $/bbl' -> a number; anything else -> null. */
export function parseNumber(text: string | null | undefined): number | null {
  let s = String(text ?? "").trim().toLowerCase().replace(/−/g, "-").replace(/–/g, "-");
  if (!s) return null;
  const neg = s.startsWith("(") && s.endsWith(")");
  if (neg) s = s.slice(1, -1);
  s = s.replace(/,/g, "").replace(/'/g, "").replace(/ /g, "");
  s = s.replace(/^([+-])\s+/, "$1");
  s = s.replace(/(usd|eur|gbp|mwh|mmbtu|bbl|lots?|per|\/|\$|€|£|%)/g, " ");
  const parts = s.split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  let head = parts[0];
  let mult = 1;
  const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, mn: 1e6, mm: 1e6, bn: 1e9, b: 1e9 };
  if (parts.length >= 2 && SUFFIX[parts[1]]) mult = SUFFIX[parts[1]];
  for (const suf of Object.keys(SUFFIX).sort((a, b) => b.length - a.length)) {
    if (head.endsWith(suf) && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(head.slice(0, -suf.length) || "x")) { head = head.slice(0, -suf.length); mult = SUFFIX[suf]; break; }
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(head)) return null;
  const v = parseFloat(head) * mult;
  return neg ? -v : v;
}
