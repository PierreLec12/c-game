/**
 * Limits, VaR and stress on the book, and what the risk manager does about a breach (section 7).
 * historicalVar is a port of c-terminal's book.historical_var (same semantics, tested on the same hand case).
 */
import { INSTRUMENTS, STRESS_SHOCKS, VAR, type InstrumentId } from "./refdata";
import { priceParts } from "./markets";
import { ckey } from "./liquidity";
import { lotValueUsd } from "./finance";
import { grossLots, netLots, tauOf } from "./pnl";
import { physicalExposureBbl } from "./physical";
import { counterpartyExposure } from "./counterparties";
import { COUNTERPARTIES } from "./world_data";
import type { Fig, RiskLimits, State } from "./types";

export interface VaRResult { level: number; loss: number; days: number; instruments: string[]; leftOut: string[]; worst: number }

/** exposure: key -> delta-equivalent units; prices: key -> price per unit; closes: key -> chronological closes. */
export function historicalVar(exposure: Record<string, number>, prices: Record<string, number>, closes: Record<string, number[]>, levels: number[] = [0.95, 0.99], window = 250): VaRResult[] {
  const included = Object.keys(exposure).filter((k) => Math.abs(exposure[k]) > 0 && closes[k] && closes[k].length >= 2 && prices[k] !== undefined);
  const leftOut = Object.keys(exposure).filter((k) => Math.abs(exposure[k]) > 0 && !included.includes(k));
  if (included.length === 0) return [];
  const rets: Record<string, number[]> = {};
  let n = Infinity;
  for (const k of included) {
    const s = closes[k];
    const r: number[] = [];
    for (let i = 1; i < s.length; i++) {
      if (s[i - 1] > 0 && s[i] > 0 && Number.isFinite(s[i - 1]) && Number.isFinite(s[i])) r.push(Math.log(s[i] / s[i - 1]));
    }
    rets[k] = r;
    n = Math.min(n, r.length);
  }
  const days = Math.min(window, n);
  if (days < 20) return [];
  const pnl: number[] = [];
  for (let d = 0; d < days; d++) {
    let x = 0;
    for (const k of included) {
      const r = rets[k];
      x += exposure[k] * prices[k] * r[r.length - days + d];
    }
    pnl.push(x);
  }
  const losses = pnl.map((x) => -x).sort((a, b) => a - b);
  return levels.map((level) => {
    const idx = Math.min(losses.length - 1, Math.max(0, Math.ceil(level * losses.length) - 1));
    return { level, loss: Math.max(0, losses[idx]), days, instruments: included, leftOut, worst: Math.max(0, losses[losses.length - 1]) };
  });
}

/** Reconstructed historical closes for each contract the book holds, from the factor history at the contract's current tau. */
export function contractCloses(state: State, keys?: string[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const wanted = keys ?? state.lots.map((l) => ckey(l.inst, l.month));
  for (const k of wanted) {
    if (out[k]) continue;
    const [inst, month] = k.split(":") as [InstrumentId, string];
    const tau = tauOf(state, inst, month);
    out[k] = state.history.map((h) => priceParts(h.factors, inst, tau).price);
  }
  return out;
}

/** The book's one-day VaR by historical simulation on the simulated closes. */
export function bookVar(state: State): Fig | null {
  const phys = physicalExposureBbl(state);
  if (state.lots.length === 0 && Math.abs(phys.bbl) < 1) return { v: 0, at: state.tick, why: "No open positions and no unpriced physical exposure: VaR is zero." };
  const exposure: Record<string, number> = {};
  const prices: Record<string, number> = {};
  for (const lot of state.lots) {
    const k = ckey(lot.inst, lot.month);
    exposure[k] = (exposure[k] ?? 0) + lot.qty * lotValueUsd(state, lot.inst);
    const q = state.quotes[k];
    prices[k] = q ? q.mid : lot.lastMark;
  }
  if (Math.abs(phys.bbl) >= 1) {
    // unpriced physical barrels behave like the front Brent contract for the simulation
    const k = ckey("BRENT", state.listed.BRENT[0]);
    exposure[k] = (exposure[k] ?? 0) + phys.bbl;
    prices[k] = state.quotes[k]?.mid ?? state.factors.brentPrompt;
  }
  const closes = contractCloses(state, Object.keys(exposure));
  const res = historicalVar(exposure, prices, closes, [VAR.level.value], VAR.window.value);
  if (res.length === 0) return null;
  const r = res[0];
  const keys = Object.keys(exposure).map((k) => `${k} (${Math.round(exposure[k] / INSTRUMENTS[k.split(":")[0] as InstrumentId].lot)} lots${Math.abs(phys.bbl) >= 1 && k.startsWith("BRENT") ? `, of which ${Math.round(phys.bbl / 1000)} lots of unpriced physical` : ""})`).join(", ");
  return { v: r.loss, at: state.tick, why: `One-day 95% VaR by historical simulation: the loss not exceeded on 95% of the last ${r.days} simulated sessions, applying each session's return of every contract you hold to today's exposure (${keys}). Worst simulated day: $${Math.round(r.worst).toLocaleString()}.` };
}

/** Full re-pricing of the book under price (and, once options exist, vol) shocks. */
export function stressTable(state: State): { priceShock: number; volShock: number; pnlChange: number }[] {
  return STRESS_SHOCKS.value.map(([dp, dv]) => {
    let change = 0;
    for (const lot of state.lots) {
      const q = state.quotes[ckey(lot.inst, lot.month)];
      const p = q ? q.mid : lot.lastMark;
      change += p * dp * lot.qty * lotValueUsd(state, lot.inst);
    }
    return { priceShock: dp, volShock: dv, pnlChange: change };
  });
}

export interface LimitCheck { limit: keyof RiskLimits | "stop_loss" | "drawdown"; value: number; limitValue: number; text: string }

/** Which limits the book breaches right now. */
export function breaches(state: State, levelPnl: number): LimitCheck[] {
  const out: LimitCheck[] = [];
  const L = state.risk.limits;
  const v = state.risk.var95;
  if (v && v.v > L.var95) out.push({ limit: "var95", value: v.v, limitValue: L.var95, text: `VaR $${Math.round(v.v).toLocaleString()} is above the limit of $${Math.round(L.var95).toLocaleString()}` });
  const net = netLots(state);
  for (const inst of Object.keys(net) as InstrumentId[]) {
    if (Math.abs(net[inst]) > L.netLots[inst]) out.push({ limit: "netLots", value: Math.abs(net[inst]), limitValue: L.netLots[inst], text: `${inst} net ${net[inst]} lots is above the ${L.netLots[inst]}-lot limit` });
  }
  const gross = grossLots(state);
  if (gross > L.grossLots) out.push({ limit: "grossLots", value: gross, limitValue: L.grossLots, text: `Gross ${gross} lots is above the ${L.grossLots}-lot limit` });
  if (levelPnl < -L.stopLoss) out.push({ limit: "stop_loss", value: -levelPnl, limitValue: L.stopLoss, text: `Level P&L ${usd(levelPnl)} is through the stop-loss of $${Math.round(L.stopLoss).toLocaleString()}` });
  if (state.risk.maxDrawdown > L.drawdown) out.push({ limit: "drawdown", value: state.risk.maxDrawdown, limitValue: L.drawdown, text: `Drawdown $${Math.round(state.risk.maxDrawdown).toLocaleString()} from the peak is above the $${Math.round(L.drawdown).toLocaleString()} limit` });
  if (L.concentration < 50) {
    const cx = counterpartyExposure(state);
    let worst: { id: string; mult: number } | null = null;
    for (const [id, v] of Object.entries(cx.byId)) { const mult = v / state.capital; if (!worst || mult > worst.mult) worst = { id, mult }; }
    if (worst && worst.mult > L.concentration) out.push({ limit: "concentration", value: worst.mult, limitValue: L.concentration, text: `${COUNTERPARTIES[worst.id]?.name ?? worst.id} is ${worst.mult.toFixed(1)}x capital of exposure, above the ${L.concentration.toFixed(1)}x concentration limit` });
  }
  return out;
}

function usd(x: number): string { return (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString(); }

/** Lots to close, pro rata, to bring the book inside the VaR and position limits. Returns a target scale in (0, 1]. */
export function reductionScale(state: State): number {
  const L = state.risk.limits;
  let scale = 1;
  const v = state.risk.var95;
  if (v && v.v > L.var95) scale = Math.min(scale, (L.var95 / v.v) * 0.9);
  const net = netLots(state);
  for (const inst of Object.keys(net) as InstrumentId[]) if (Math.abs(net[inst]) > L.netLots[inst]) scale = Math.min(scale, (L.netLots[inst] / Math.abs(net[inst])) * 0.9);
  const gross = grossLots(state);
  if (gross > L.grossLots) scale = Math.min(scale, (L.grossLots / gross) * 0.9);
  return Math.max(0, scale);
}

/** The worst stress row, for the risk manager to quote. */
export function worstStress(state: State): string {
  if (!state.risk.stress.length) return "";
  const w = state.risk.stress.reduce((a, r) => (r.pnlChange < a.pnlChange ? r : a), state.risk.stress[0]);
  return `Stress: a ${Math.round(w.priceShock * 100)}% price move${w.volShock ? ` with vol ${w.volShock > 0 ? "+" : ""}${Math.round(w.volShock * 100)} points` : ""} costs ${usd(w.pnlChange)} on this book.`;
}
