/**
 * Mark-to-market and attribution by leg (section 8). Every contract price is a sum of named factors
 * (markets.ts), so each lot's P&L between two marks splits exactly into factor legs plus a residual
 * that is the cost of crossing the spread and the exchange fee. Rows are written at every settle and
 * at every close of a lot; between settles the book shows the unrealised part separately.
 */
import { monthLabel } from "./calendar";
import { INSTRUMENTS, type InstrumentId } from "./refdata";
import { priceParts } from "./markets";
import { ckey } from "./liquidity";
import { lotValueUsd, markEur } from "./finance";
import type { AttributionLeg, AttributionRow, Fill, Lot, State } from "./types";
import { attributeOptionLot, lotKey, optionExpiryTick, optionInputs, optionValue } from "./optionbook";

export function tauOf(state: State, inst: InstrumentId, month: string): number {
  const c = state.contracts[ckey(inst, month)];
  if (!c) return 0;
  return Math.max(0, (c.expiryTick - state.tick) / 24 / 30.4375);
}

export function partsNow(state: State, inst: InstrumentId, month: string): Record<string, number> {
  return priceParts(state.factors, inst, tauOf(state, inst, month)).parts;
}

const LEG_OF: Record<string, AttributionLeg> = { flat: "flat", basis: "basis", crack: "crack", time_spread: "time_spread" };

function fmt(x: number, d = 2): string { return (x >= 0 ? "+" : "") + x.toFixed(d); }
function usd(x: number): string { return (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString(); }

/** Attribution of one lot from its base to the current mark `price`, for `qty` of its lots (same sign as lot.qty). Mutates nothing. */
export function attributeLot(state: State, lot: Lot, qty: number, price: number, parts: Record<string, number>, fxNow: number): AttributionRow[] {
  const spec = INSTRUMENTS[lot.inst];
  const lotUsdPrev = spec.lot * (spec.currency === "EUR" ? lot.baseFx : 1);
  const lotUsdNow = spec.lot * (spec.currency === "EUR" ? fxNow : 1);
  const rows: AttributionRow[] = [];
  const name = `${spec.name} ${monthLabel(lot.month)}`;
  const side = qty > 0 ? "long" : "short";
  let legsSum = 0;
  for (const [k, now] of Object.entries(parts)) {
    const before = lot.base[k] ?? now;
    const d = now - before;
    const amount = d * qty * lotUsdPrev;
    legsSum += amount;
    if (Math.abs(amount) < 0.005) continue;
    const leg = LEG_OF[k] ?? "flat";
    let text: string;
    const dd = spec.decimals;
    if (leg === "flat") text = `${lot.inst === "WTI" || lot.inst === "RBOB" || lot.inst === "ULSD" ? "The crude flat price (Brent prompt)" : `${spec.name} flat price`} moved ${fmt(d, dd)} ${spec.unit} while you were ${side} ${Math.abs(qty)} lot${Math.abs(qty) > 1 ? "s" : ""} of ${name}: ${lot.tag === "hedge" ? "hedge leg" : "flat-price exposure"}.`;
    else if (leg === "basis" && lot.inst === "DUBAI") text = `Brent minus Dubai moved ${fmt(-d, 2)} $/bbl on your ${side} ${Math.abs(qty)} lots of ${name}: the East-West spread.`;
    else if (leg === "basis") text = `Brent minus WTI moved ${fmt(-d * (lot.inst === "WTI" ? 1 : 42), 2)} $/bbl: your ${name} ${side} carries Brent-WTI basis.`;
    else if (leg === "crack") text = `The ${lot.inst === "RBOB" ? "gasoline" : "diesel"} crack moved ${fmt(d * 42, 2)} $/bbl on your ${side} ${Math.abs(qty)} lots of ${name}.`;
    else text = `Time structure on ${name} moved ${fmt(d, dd)} ${spec.unit} (front spread and roll-down as the contract neared expiry) while you were ${side} ${Math.abs(qty)} lots.`;
    rows.push({ tick: state.tick, inst: lot.inst, month: lot.month, leg, amount, text, lotId: lot.id, packageId: lot.packageId });
  }
  const total = (price - lot.lastMark) * qty * lotUsdNow;
  const fxLeg = spec.currency === "EUR" ? (price - lot.lastMark) * qty * spec.lot * (fxNow - lot.baseFx) : 0;
  if (Math.abs(fxLeg) >= 0.005) rows.push({ tick: state.tick, inst: lot.inst, month: lot.month, leg: "fx", amount: fxLeg, text: `EURUSD moved from ${lot.baseFx.toFixed(4)} to ${fxNow.toFixed(4)} on this period's EUR variation margin.`, lotId: lot.id, packageId: lot.packageId });
  const residual = total - legsSum - fxLeg;
  if (Math.abs(residual) >= 0.005) rows.push({ tick: state.tick, inst: lot.inst, month: lot.month, leg: "fees_slippage", amount: residual, text: `Crossing the spread and your own order impact on ${name}: paid ${usd(-residual)} over the model mid.`, lotId: lot.id, packageId: lot.packageId });
  return rows;
}

/** At a settle: variation margin to cash for every lot, attribution rows, bases reset. Returns the day's P&L in USD. */
export function settleLots(state: State, settlePrices: Record<string, number>): { rows: AttributionRow[]; vmUsd: number; vmEur: number } {
  const rows: AttributionRow[] = [];
  let vmUsd = 0;
  let vmEur = 0;
  const fx = state.factors.eurusd;
  for (const lot of state.lots) {
    const key = ckey(lot.inst, lot.month);
    const futPrice = settlePrices[key];
    if (futPrice === undefined) continue;
    const spec = INSTRUMENTS[lot.inst];
    let price: number;
    if (lot.option) {
      // an option settles at its model value off the future's settle; at its own expiry, at intrinsic value
      const atExpiry = lot.option.expiryTick <= state.tick;
      const inp = optionInputs(state, lot.inst, lot.month, lot.option.strike, lot.option.expiryTick, futPrice);
      price = optionValue(lot.option.kind, lot.option.strike, inp, atExpiry).price;
      rows.push(...attributeOptionLot(state, lot, lot.qty, price, inp, atExpiry));
      lot.option.base = inp;
    } else {
      price = futPrice;
      const parts = partsNow(state, lot.inst, lot.month);
      rows.push(...attributeLot(state, lot, lot.qty, price, parts, fx));
      lot.base = parts;
    }
    const vm = (price - lot.lastMark) * lot.qty * spec.lot;
    if (spec.currency === "EUR") vmEur += vm;
    else vmUsd += vm;
    lot.lastMark = price;
    lot.baseFx = fx;
  }
  return { rows: aggregate(rows), vmUsd, vmEur };
}

/** Rows of the same instrument, month and leg at the same tick are summed; the first sentence is kept with the net figure. */
export function aggregate(rows: AttributionRow[]): AttributionRow[] {
  const map = new Map<string, AttributionRow>();
  for (const r of rows) {
    const k = `${r.tick}|${r.inst}|${r.month}|${r.leg}|${r.greek ?? ""}|${r.packageId ?? ""}`;
    const prev = map.get(k);
    if (prev) prev.amount += r.amount;
    else map.set(k, { ...r, lotId: undefined });
  }
  return [...map.values()].filter((r) => Math.abs(r.amount) >= 0.005);
}

/** Apply a fill to the lots: offset opposite lots first in, first out (realising P&L), open the remainder. Mutates state. Returns realised USD. */
export function applyFillToLots(state: State, fill: Fill): { realised: number; rows: AttributionRow[] } {
  const spec = INSTRUMENTS[fill.inst];
  const sign = fill.side === "buy" ? 1 : -1;
  let remaining = fill.qty;
  let realised = 0;
  const rows: AttributionRow[] = [];
  const fx = state.factors.eurusd;
  const parts = partsNow(state, fill.inst, fill.month);
  const lotUsd = lotValueUsd(state, fill.inst);
  const fillKey = fill.option ? `${fill.inst}:${fill.month}:${fill.option.kind}:${fill.option.strike}` : ckey(fill.inst, fill.month);
  const optInputs = fill.option ? optionInputs(state, fill.inst, fill.month, fill.option.strike) : null;
  const keep: Lot[] = [];
  for (const lot of state.lots) {
    if (remaining > 0 && lotKey(lot) === fillKey && Math.sign(lot.qty) === -sign) {
      const closeQty = Math.min(remaining, Math.abs(lot.qty));
      const closedSigned = -sign * closeQty; // the lot's own sign
      if (lot.option && optInputs) rows.push(...attributeOptionLot(state, lot, closedSigned, fill.price, optInputs, false));
      else rows.push(...attributeLot(state, lot, closedSigned, fill.price, parts, fx));
      const pnl = (fill.price - lot.lastMark) * closedSigned * lotUsd;
      if (spec.currency === "EUR") {
        // EUR P&L settles into the EUR cash account; book it now in EUR, after revaluing the balance already there
        markEur(state);
        state.finance.cashEUR += pnl / fx;
        state.finance.ledger.push({ id: `l${++state.counters.ledger}`, tick: state.tick, kind: "variation_margin", amount: pnl / fx, currency: "EUR", text: `Closed ${closeQty} lots of ${fill.inst} ${monthLabel(fill.month)} at ${fill.price.toFixed(spec.decimals)}` });
      } else {
        state.finance.cashUSD += pnl;
        state.finance.ledger.push({ id: `l${++state.counters.ledger}`, tick: state.tick, kind: "variation_margin", amount: pnl, currency: "USD", text: `Closed ${closeQty} lots of ${fill.inst} ${monthLabel(fill.month)}${fill.option ? ` ${fill.option.strike} ${fill.option.kind}` : ""} at ${fill.price.toFixed(spec.decimals)}: ${usd(pnl)} realised` });
      }
      realised += pnl;
      remaining -= closeQty;
      lot.qty += sign * closeQty;
      if (lot.qty !== 0) keep.push(lot);
    } else keep.push(lot);
  }
  state.lots = keep;
  if (remaining > 0) {
    const lot: Lot = {
      id: `L${++state.counters.lot}`, inst: fill.inst, month: fill.month, qty: sign * remaining, entry: fill.price, openedTick: state.tick,
      tag: fill.tag, packageId: fill.packageId, base: parts, baseFx: fx, lastMark: fill.price,
    };
    if (fill.option && optInputs) lot.option = { kind: fill.option.kind, strike: fill.option.strike, expiryTick: optionExpiryTick(state, fill.inst, fill.month), base: optInputs };
    state.lots.push(lot);
  }
  state.pnl.realised += realised;
  return { realised, rows: aggregate(rows) };
}

/** Unrealised P&L since the last settle, in USD, from the current mids. */
export function unrealised(state: State): number {
  let u = 0;
  for (const lot of state.lots) {
    const q = state.quotes[ckey(lot.inst, lot.month)];
    if (!q) continue;
    const mark = lot.option ? optionValue(lot.option.kind, lot.option.strike, optionInputs(state, lot.inst, lot.month, lot.option.strike, lot.option.expiryTick), lot.option.expiryTick <= state.tick).price : q.mid;
    u += (mark - lot.lastMark) * lot.qty * lotValueUsd(state, lot.inst);
  }
  return u;
}

export function netLots(state: State): Record<InstrumentId, number> {
  const out = { BRENT: 0, WTI: 0, RBOB: 0, ULSD: 0, HH: 0, TTF: 0, DUBAI: 0, JKM: 0 } as Record<InstrumentId, number>;
  for (const lot of state.lots) if (!lot.option) out[lot.inst] += lot.qty;
  return out;
}
export function grossLots(state: State): number {
  return state.lots.filter((l) => !l.option).reduce((a, l) => a + Math.abs(l.qty), 0);
}

/** Positions by contract, aggregated from the lots, with an average entry. */
export interface PositionRow { inst: InstrumentId; month: string; qty: number; avgEntry: number; lastMark: number; mid: number | null; unrealised: number; tags: string[]; lotIds: string[]; option?: { kind: "call" | "put"; strike: number; expiryTick: number } }
export function positions(state: State): PositionRow[] {
  const map = new Map<string, PositionRow>();
  for (const lot of state.lots) {
    const k = lotKey(lot);
    const q = state.quotes[ckey(lot.inst, lot.month)];
    const mark = lot.option ? optionValue(lot.option.kind, lot.option.strike, optionInputs(state, lot.inst, lot.month, lot.option.strike, lot.option.expiryTick), lot.option.expiryTick <= state.tick).price : q ? q.mid : null;
    const row = map.get(k) ?? { inst: lot.inst, month: lot.month, qty: 0, avgEntry: 0, lastMark: lot.lastMark, mid: mark, unrealised: 0, tags: [], lotIds: [], option: lot.option ? { kind: lot.option.kind, strike: lot.option.strike, expiryTick: lot.option.expiryTick } : undefined };
    const newQty = row.qty + lot.qty;
    row.avgEntry = newQty !== 0 ? (row.avgEntry * row.qty + lot.entry * lot.qty) / newQty : 0;
    row.qty = newQty;
    row.unrealised += mark !== null ? (mark - lot.lastMark) * lot.qty * lotValueUsd(state, lot.inst) : 0;
    if (!row.tags.includes(lot.tag)) row.tags.push(lot.tag);
    row.lotIds.push(lot.id);
    map.set(k, row);
  }
  return [...map.values()].filter((r) => r.qty !== 0);
}

export function attributionTotals(rows: AttributionRow[]): Record<AttributionLeg, number> {
  const out: Record<AttributionLeg, number> = { flat: 0, basis: 0, time_spread: 0, crack: 0, fees_slippage: 0, fx: 0, finance: 0, options: 0, freight: 0, demurrage: 0, storage: 0, quality: 0, credit: 0, refinery: 0 };
  for (const r of rows) out[r.leg] += r.amount;
  return out;
}

/** The exchange and clearing fee of a fill as an attribution row, so the legs still sum to the book. */
export function feeRow(state: State, fill: Fill): AttributionRow {
  const spec = INSTRUMENTS[fill.inst];
  return { tick: state.tick, inst: fill.inst, month: fill.month, leg: "fees_slippage", amount: -fill.fees, text: `Exchange and clearing fees: ${fill.qty} lots of ${spec.name} ${monthLabel(fill.month)}${fill.option ? ` ${fill.option.strike} ${fill.option.kind}` : ""} at $${spec.fee.value.toFixed(2)} a lot.` };
}
