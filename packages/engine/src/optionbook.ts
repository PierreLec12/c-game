/**
 * Options on the futures (sections 5.1 and 6): a listed strike grid per month, priced by Black-76 off the month's
 * futures mid and the vol surface, traded at model value plus a vol spread, margined like futures (no premium
 * changes hands at the fill; variation margin settles daily: stylised ICE Brent style), attributed by Greek at every
 * settle and at every close, and cash-settled at intrinsic value on the option's own expiry, three business days
 * before its future. The maths is the ported Black-76 in options.ts; this file is the book around it.
 */
import { black76, type Greeks } from "./options";
import { impliedVolAt, roundToTick } from "./markets";
import { BLOCK_SHARE_OF_VOLUME, INSTRUMENTS, LIQUIDITY, OPTIONS, type InstrumentId } from "./refdata";
import { ckey, nextId } from "./liquidity";
import { HOURS_PER_DAY, addBusinessDays, expiryDay, monthLabel } from "./calendar";
import { CLOCK } from "./refdata";
import type { AttributionRow, Fill, Greek, Lot, Order, State } from "./types";

import type { OptionKind } from "./options";
export type { OptionKind };
export const optionKey = (inst: InstrumentId, month: string, kind: OptionKind, strike: number): string => `${inst}:${month}:${kind}:${strike}`;
/** The key a lot nets against: the option's own key, or the futures contract's. */
export const lotKey = (lot: Lot): string => (lot.option ? optionKey(lot.inst, lot.month, lot.option.kind, lot.option.strike) : ckey(lot.inst, lot.month));
export const isOption = (lot: Lot): boolean => lot.option !== undefined;

/** The last tick an option on `month` trades: its settle three business days before the future's last day (stylised). */
export function optionExpiryTick(state: State, inst: InstrumentId, month: string): number {
  const day = addBusinessDays(expiryDay(inst, month), -OPTIONS.expiryBusinessDaysBeforeFuture.value);
  return (day - state.startDay) * HOURS_PER_DAY + CLOCK.settleHour.value;
}

export interface OptionInputs { F: number; sigma: number; T: number }

/** The pricing inputs now: the future's mid, the surface vol at this tenor and moneyness, and years to the option's expiry. */
export function optionInputs(state: State, inst: InstrumentId, month: string, strike: number, expiryTick?: number, F?: number): OptionInputs {
  const q = state.quotes[ckey(inst, month)];
  const f = F ?? (q ? q.mid : 0);
  const exp = expiryTick ?? optionExpiryTick(state, inst, month);
  const hours = Math.max(0, exp - state.tick);
  const T = Math.max(hours, 1) / HOURS_PER_DAY / 365;
  const sigma = impliedVolAt(state.factors.vol[inst], hours / HOURS_PER_DAY / 30.4375, f > 0 ? strike / f - 1 : 0);
  return { F: f, sigma, T };
}

export const intrinsic = (kind: OptionKind, F: number, K: number): number => Math.max(0, kind === "call" ? F - K : K - F);

/** Model value of an option: Black-76 before expiry, intrinsic at it. */
export function optionValue(kind: OptionKind, strike: number, inp: OptionInputs, atExpiry = false): { price: number; greeks: Greeks | null } {
  if (atExpiry) return { price: intrinsic(kind, inp.F, strike), greeks: null };
  const g = black76(kind, inp.F, strike, inp.T, inp.sigma);
  if (!g) return { price: intrinsic(kind, inp.F, strike), greeks: null };
  return { price: g.price, greeks: g };
}

/** The listed strikes for a month: a grid either side of the forward at the instrument's step. */
export function listedStrikes(state: State, inst: InstrumentId, month: string): number[] {
  const q = state.quotes[ckey(inst, month)];
  if (!q) return [];
  const step = OPTIONS.strikeStep.value[inst];
  const centre = Math.round(q.mid / step) * step;
  const out: number[] = [];
  for (let k = -OPTIONS.strikesEachSide.value; k <= OPTIONS.strikesEachSide.value; k++) {
    const s = Math.round((centre + k * step) / step) * step;
    if (s > 0) out.push(Number(s.toFixed(6)));
  }
  return out;
}
export function isListedStrike(state: State, inst: InstrumentId, month: string, strike: number): boolean {
  return listedStrikes(state, inst, month).some((s) => Math.abs(s - strike) < 1e-9);
}

export interface OptionQuote {
  inst: InstrumentId; month: string; kind: OptionKind; strike: number;
  mid: number; bid: number; ask: number; depth: number; iv: number; expiryTick: number; open: boolean;
  greeks: Greeks | null; why: string;
}

/** The option's two-way price: model value at the surface vol, one vol point wide (stylised vol spread), with depth. */
export function optionQuote(state: State, inst: InstrumentId, month: string, kind: OptionKind, strike: number): OptionQuote | null {
  const q = state.quotes[ckey(inst, month)];
  const spec = INSTRUMENTS[inst];
  if (!q || !spec) return null;
  const expiryTick = optionExpiryTick(state, inst, month);
  if (expiryTick <= state.tick) return null;
  const inp = optionInputs(state, inst, month, strike, expiryTick);
  const half = OPTIONS.volSpreadPoints.value / 2 / 100;
  const v = optionValue(kind, strike, inp);
  const lo = optionValue(kind, strike, { ...inp, sigma: Math.max(0.01, inp.sigma - half) }).price;
  const hi = optionValue(kind, strike, { ...inp, sigma: inp.sigma + half }).price;
  const mid = roundToTick(v.price, spec.tick);
  const bid = Math.max(0, roundToTick(lo, spec.tick));
  const ask = Math.max(spec.tick, roundToTick(hi, spec.tick));
  const idx = Math.max(0, state.listed[inst].indexOf(month));
  const depth = Math.max(1, Math.round(OPTIONS.depthLots.value * Math.pow(LIQUIDITY.monthDepthDecay.value, idx) * LIQUIDITY.regimeDepth.value[state.world.regime] * (idx >= 2 ? state.depthScale : 1)));
  const days = (expiryTick - state.tick) / HOURS_PER_DAY;
  const why = `Black-76 on the ${spec.name} ${monthLabel(month)} future at ${inp.F.toFixed(spec.decimals)}: strike ${strike}, ${days.toFixed(0)} days to the option's expiry (three business days before the future's, stylised), vol ${(inp.sigma * 100).toFixed(1)}% from the surface (front ${(state.factors.vol[inst] * 100).toFixed(1)}%, term and skew applied). Model ${v.price.toFixed(spec.decimals)}; the market shows it ${OPTIONS.volSpreadPoints.value} vol point wide: bid at ${((inp.sigma - half) * 100).toFixed(1)}%, ask at ${((inp.sigma + half) * 100).toFixed(1)}%. Depth ${depth} lots. Futures-style: no premium moves at the fill; the value settles daily as variation margin.`;
  return { inst, month, kind, strike, mid, bid, ask, depth, iv: inp.sigma, expiryTick, open: q.open, greeks: v.greeks, why };
}

export interface OptionFillEstimate { price: number; slippage: number; fees: number; notional: number; refusal: string | null; quote: OptionQuote | null }

export function estimateOptionFill(state: State, inst: InstrumentId, month: string, kind: OptionKind, strike: number, side: "buy" | "sell", qty: number): OptionFillEstimate {
  const spec = INSTRUMENTS[inst];
  const none = (refusal: string, quote: OptionQuote | null = null): OptionFillEstimate => ({ price: 0, slippage: 0, fees: 0, notional: 0, refusal, quote });
  if (!spec) return none(`unknown instrument ${inst}`);
  if (!state.listed[inst].includes(month)) return none(`${inst} ${month} is not listed`);
  if (!isListedStrike(state, inst, month, strike)) return none(`${strike} is not a listed strike: the grid runs ${listedStrikes(state, inst, month)[0]} to ${listedStrikes(state, inst, month).slice(-1)[0]} in steps of ${OPTIONS.strikeStep.value[inst]}`);
  const q = optionQuote(state, inst, month, kind, strike);
  if (!q) return none(`no option market on ${inst} ${month}: the option has expired`);
  if (!Number.isInteger(qty) || qty <= 0) return none("quantity must be a whole number of lots above zero", q);
  const block = Math.max(1, Math.floor((spec.dailyVolumeLots.value * BLOCK_SHARE_OF_VOLUME.value) / 4));
  if (qty > block) return none(`${qty} lots is above the option block size (${block} lots, a quarter of the future's block rule): refused`, q);
  const spread = q.ask - q.bid;
  const slip = roundToTick(LIQUIDITY.slippagePerDepth.value * (qty / q.depth) * spread, spec.tick);
  const price = side === "buy" ? q.ask + slip : Math.max(0, q.bid - slip);
  const fees = qty * spec.fee.value;
  const notional = q.mid * qty * spec.lot * (spec.currency === "EUR" ? state.factors.eurusd : 1);
  const refusal = q.open ? null : "the market is closed: options trade with their future";
  return { price, slippage: slip, fees, notional, refusal, quote: q };
}

export function makeOptionOrder(state: State, player: string, inst: InstrumentId, month: string, side: "buy" | "sell", qty: number, kind: OptionKind, strike: number, tag: Order["tag"], packageId?: string): Order {
  return { id: nextId(state, "order", "o"), player, inst, month, side, qty, kind: "market", tag, packageId, option: { kind, strike }, placedTick: state.tick, status: "resting" };
}

/** Execute an option order at the touch plus slippage. No market impact is modelled on options (stylised). */
export function executeOption(state: State, order: Order): { fill: Fill | null; refusal: string | null } {
  const o = order.option!;
  const est = estimateOptionFill(state, order.inst, order.month, o.kind, o.strike, order.side, order.qty);
  if (est.refusal) return { fill: null, refusal: est.refusal };
  const q = est.quote!;
  const fill: Fill = {
    id: nextId(state, "fill", "f"), tick: state.tick, orderId: order.id, inst: order.inst, month: order.month, side: order.side, qty: order.qty,
    price: est.price, mid: q.mid, slippage: est.slippage, fees: est.fees, tag: order.tag, packageId: order.packageId, option: { kind: o.kind, strike: o.strike, iv: q.iv },
  };
  state.fills.push(fill);
  order.status = "filled";
  return { fill, refusal: null };
}

const fmt = (x: number, d = 2): string => (x >= 0 ? "+" : "") + x.toFixed(d);
const usd = (x: number): string => (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString();

/**
 * Attribution of an option lot from its base inputs to `price` for `qty` of its lots: the move split by Greek
 * (delta, gamma, vega, theta from the base Greeks), a model residual (higher-order terms and the skew drift), and
 * the spread crossed against the model mid. Mutates nothing.
 */
export function attributeOptionLot(state: State, lot: Lot, qty: number, price: number, now: OptionInputs, atExpiry: boolean): AttributionRow[] {
  const spec = INSTRUMENTS[lot.inst];
  const o = lot.option!;
  const lotUsd = spec.lot * (spec.currency === "EUR" ? state.factors.eurusd : 1);
  const base = o.base;
  const g = black76(o.kind, base.F, o.strike, base.T, base.sigma);
  const name = `${spec.name} ${monthLabel(lot.month)} ${o.strike} ${o.kind}`;
  const side = qty > 0 ? "long" : "short";
  const n = Math.abs(qty);
  const rows: AttributionRow[] = [];
  const push = (greek: Greek, amount: number, text: string) => { if (Math.abs(amount) >= 0.005) rows.push({ tick: state.tick, inst: lot.inst, month: lot.month, leg: "options", greek, amount, text, lotId: lot.id, packageId: lot.packageId }); };
  let explained = 0;
  if (g) {
    const dF = now.F - base.F;
    const dVol = (now.sigma - base.sigma) * 100;
    const dDays = Math.max(0, (base.T - now.T) * 365);
    const delta = g.delta * dF * qty * lotUsd;
    const gamma = 0.5 * g.gamma * dF * dF * qty * lotUsd;
    const vega = g.vega * dVol * qty * lotUsd;
    const theta = g.theta * dDays * qty * lotUsd;
    explained = delta + gamma + vega + theta;
    push("delta", delta, `${name}: the future moved ${fmt(dF, spec.decimals)} on a delta of ${g.delta.toFixed(2)} while you were ${side} ${n} lot${n > 1 ? "s" : ""}: the hedge ratio part of the move.`);
    push("gamma", gamma, `${name}: gamma ${g.gamma.toFixed(4)} on a ${fmt(dF, spec.decimals)} move: the delta changed as the future moved (${side} gamma ${gamma >= 0 ? "earns" : "costs"} on a big move).`);
    push("vega", vega, `${name}: implied vol moved ${fmt(dVol, 1)} points on a vega of ${g.vega.toFixed(3)} per point, ${side} ${n} lots: vol is a price and it moved.`);
    push("theta", theta, `${name}: ${dDays.toFixed(1)} day${dDays === 1 ? "" : "s"} passed at a theta of ${g.theta.toFixed(4)} a day, ${side} ${n} lots: time decay${qty > 0 ? " paid" : " earned"}.`);
  }
  const model = optionValue(o.kind, o.strike, now, atExpiry).price;
  const other = (model - lot.lastMark) * qty * lotUsd - explained;
  push("other", other, `${name}: the rest of the model move (higher-order terms, the skew and term structure of the surface${atExpiry ? ", settlement at intrinsic value" : ""}).`);
  const spread = (price - model) * qty * lotUsd;
  if (Math.abs(spread) >= 0.005) rows.push({ tick: state.tick, inst: lot.inst, month: lot.month, leg: "fees_slippage", amount: spread, text: `Crossing the vol spread on ${name}: paid ${usd(-spread)} against the model mid.`, lotId: lot.id, packageId: lot.packageId });
  return rows;
}

/** Short option lots not covered by the underlying, per instrument: a short call needs long futures or long physical behind it, a short put short ones. */
export function nakedShortOptions(state: State, coverLots: Record<InstrumentId, number>): { total: number; byInst: Partial<Record<InstrumentId, { calls: number; puts: number; cover: number; naked: number }>> } {
  const byInst: ReturnType<typeof nakedShortOptions>["byInst"] = {};
  let total = 0;
  for (const lot of state.lots) {
    if (!lot.option || lot.qty >= 0) continue;
    const row = byInst[lot.inst] ?? (byInst[lot.inst] = { calls: 0, puts: 0, cover: coverLots[lot.inst] ?? 0, naked: 0 });
    if (lot.option.kind === "call") row.calls += -lot.qty;
    else row.puts += -lot.qty;
  }
  for (const row of Object.values(byInst)) {
    if (!row) continue;
    const longCover = Math.max(0, row.cover);
    const shortCover = Math.max(0, -row.cover);
    row.naked = Math.max(0, row.calls - longCover) + Math.max(0, row.puts - shortCover);
    total += row.naked;
  }
  return { total, byInst };
}

/** Standard strategies as their legs (section 6): what each trades, for the ticket and the strategy action. */
export function strategyLegs(name: "collar" | "put_spread" | "call_spread" | "straddle" | "strangle", strikes: number[], side: "buy" | "sell"): { kind: OptionKind; strike: number; side: "buy" | "sell" }[] {
  const flip = (s: "buy" | "sell"): "buy" | "sell" => (side === "buy" ? s : s === "buy" ? "sell" : "buy");
  const k = [...strikes].sort((a, b) => a - b);
  switch (name) {
    case "collar": return [{ kind: "put", strike: k[0], side: flip("buy") }, { kind: "call", strike: k[1], side: flip("sell") }];
    case "put_spread": return [{ kind: "put", strike: k[1], side: flip("buy") }, { kind: "put", strike: k[0], side: flip("sell") }];
    case "call_spread": return [{ kind: "call", strike: k[0], side: flip("buy") }, { kind: "call", strike: k[1], side: flip("sell") }];
    case "straddle": return [{ kind: "call", strike: k[0], side: flip("buy") }, { kind: "put", strike: k[0], side: flip("buy") }];
    case "strangle": return [{ kind: "put", strike: k[0], side: flip("buy") }, { kind: "call", strike: k[1], side: flip("buy") }];
  }
}
export const STRATEGY_STRIKES: Record<"collar" | "put_spread" | "call_spread" | "straddle" | "strangle", number> = { collar: 2, put_spread: 2, call_spread: 2, straddle: 1, strangle: 2 };

/** Book Greeks: the delta-equivalent lots, gamma, vega and theta of every option position, by instrument and in total. */
export interface GreekRow { inst: InstrumentId; month: string; kind: OptionKind; strike: number; qty: number; price: number; iv: number; delta: number; gamma: number; vega: number; theta: number; deltaLots: number; expiryTick: number; lotIds: string[] }
export function optionPositions(state: State): GreekRow[] {
  const map = new Map<string, GreekRow>();
  for (const lot of state.lots) {
    if (!lot.option) continue;
    const key = lotKey(lot);
    const inp = optionInputs(state, lot.inst, lot.month, lot.option.strike, lot.option.expiryTick);
    const v = optionValue(lot.option.kind, lot.option.strike, inp, lot.option.expiryTick <= state.tick);
    const g = v.greeks;
    const row = map.get(key) ?? { inst: lot.inst, month: lot.month, kind: lot.option.kind, strike: lot.option.strike, qty: 0, price: v.price, iv: inp.sigma, delta: g?.delta ?? 0, gamma: g?.gamma ?? 0, vega: g?.vega ?? 0, theta: g?.theta ?? 0, deltaLots: 0, expiryTick: lot.option.expiryTick, lotIds: [] };
    row.qty += lot.qty;
    row.deltaLots = row.qty * row.delta;
    row.lotIds.push(lot.id);
    map.set(key, row);
  }
  return [...map.values()].filter((r) => r.qty !== 0);
}
/** Delta-equivalent lots of the option book per instrument (what the options add to the futures net). */
export function optionDeltaLots(state: State): Partial<Record<InstrumentId, number>> {
  const out: Partial<Record<InstrumentId, number>> = {};
  for (const r of optionPositions(state)) out[r.inst] = (out[r.inst] ?? 0) + r.deltaLots;
  return out;
}
