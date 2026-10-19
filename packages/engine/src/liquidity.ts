/**
 * Bid-ask, depth, slippage, impact and fills (section 5.3). Orders reach the market only through
 * submitOrder (the multiplayer seam of section 3.5). Physical tenders arrive in milestone 2.
 */
import { dayOfTick, hourOfTick, isTradingTick } from "./calendar";
import { BLOCK_SHARE_OF_VOLUME, INSTRUMENTS, LIQUIDITY, type InstrumentId } from "./refdata";
import type { Fill, LegTag, Order, Quote, State } from "./types";
import { roundToTick } from "./markets";

export const ckey = (inst: InstrumentId, month: string) => `${inst}:${month}`;

export function quoteOf(state: State, inst: InstrumentId, month: string): Quote | null {
  return state.quotes[ckey(inst, month)] ?? null;
}

export interface FillEstimate {
  price: number;
  slippage: number;
  fees: number;
  notional: number;
  refusal: string | null;
  quote: Quote | null;
}

/** What the ticket shows before the click: the touch, the slippage for this size, fees. */
export function estimateFill(state: State, inst: InstrumentId, month: string, side: "buy" | "sell", qty: number): FillEstimate {
  const spec = INSTRUMENTS[inst];
  const q = quoteOf(state, inst, month);
  if (!q) return { price: 0, slippage: 0, fees: 0, notional: 0, refusal: `${inst} ${month} is not listed`, quote: null };
  if (!Number.isInteger(qty) || qty <= 0) return { price: 0, slippage: 0, fees: 0, notional: 0, refusal: "quantity must be a whole number of lots above zero", quote: q };
  const block = Math.floor(spec.dailyVolumeLots.value * BLOCK_SHARE_OF_VOLUME.value);
  if (qty > block) return { price: 0, slippage: 0, fees: 0, notional: 0, refusal: `${qty} lots is above ${(BLOCK_SHARE_OF_VOLUME.value * 100).toFixed(0)}% of daily volume (${block} lots): a block that size is refused`, quote: q };
  const spread = q.ask - q.bid;
  const slip = roundToTick(LIQUIDITY.slippagePerDepth.value * (qty / q.depth) * spread, spec.tick);
  const price = side === "buy" ? q.ask + slip : q.bid - slip;
  const fees = qty * spec.fee.value;
  const notional = price * qty * spec.lot * (spec.currency === "EUR" ? state.factors.eurusd : 1);
  const refusal = q.open ? null : "the market is closed: a market order would wait for the open; use a limit order to rest it";
  return { price: Math.max(spec.tick, price), slippage: slip, fees, notional, refusal, quote: q };
}

export function nextId(state: State, kind: keyof State["counters"], prefix: string): string {
  state.counters[kind] += 1;
  return `${prefix}${state.counters[kind]}`;
}

/** Execute a market order at the touch plus slippage. Mutates `state`. Returns the fill or a refusal. */
export function executeMarket(state: State, order: Order): { fill: Fill | null; refusal: string | null } {
  const est = estimateFill(state, order.inst, order.month, order.side, order.qty);
  if (est.refusal) return { fill: null, refusal: est.refusal };
  const q = est.quote!;
  const spec = INSTRUMENTS[order.inst];
  const c = state.contracts[ckey(order.inst, order.month)];
  const fill: Fill = {
    id: nextId(state, "fill", "f"), tick: state.tick, orderId: order.id, inst: order.inst, month: order.month, side: order.side, qty: order.qty,
    price: est.price, mid: q.mid, slippage: est.slippage, fees: est.fees, tag: order.tag, packageId: order.packageId,
  };
  // impact: the mid moves a fraction of the spread per unit of depth consumed, and decays over following ticks
  const spread = q.ask - q.bid;
  const impact = LIQUIDITY.impactPerDepth.value * (order.qty / q.depth) * spread * (order.side === "buy" ? 1 : -1);
  c.impact += impact;
  c.volumeToday += order.qty;
  state.quotes[ckey(order.inst, order.month)] = { ...q, mid: q.mid + impact, bid: roundToTick(q.bid + impact, spec.tick), ask: roundToTick(q.ask + impact, spec.tick) };
  state.fills.push(fill);
  order.status = "filled";
  return { fill, refusal: null };
}

/** Rest a limit or stop order. */
export function restOrder(state: State, order: Order): void {
  order.status = "resting";
  state.orders.push(order);
}

/** Each trading tick: trigger stops, fill limits that the touch has crossed. Returns the fills made. */
export function matchResting(state: State): Fill[] {
  const fills: Fill[] = [];
  if (!isTradingTick(state.startDay, state.tick)) return fills;
  for (const o of state.orders) {
    if (o.status !== "resting") continue;
    const q = quoteOf(state, o.inst, o.month);
    if (!q || !q.open) continue;
    if (o.kind === "limit" && o.price !== undefined) {
      const crosses = o.side === "buy" ? q.ask <= o.price : q.bid >= o.price;
      if (!crosses) continue;
      const market: Order = { ...o, kind: "market" };
      const { fill } = executeMarket(state, market);
      if (fill) {
        // a limit never fills worse than its price: the resting order was first in the queue at that price
        if (o.side === "buy") fill.price = Math.min(fill.price, o.price);
        else fill.price = Math.max(fill.price, o.price);
        fill.slippage = o.side === "buy" ? fill.price - q.ask : q.bid - fill.price;
        fill.orderId = o.id;
        o.status = "filled";
        fills.push(fill);
      }
    } else if (o.kind === "stop" && o.price !== undefined) {
      const triggers = o.side === "buy" ? q.ask >= o.price : q.bid <= o.price;
      if (!triggers) continue;
      const market: Order = { ...o, kind: "market" };
      const { fill } = executeMarket(state, market);
      if (fill) { fill.orderId = o.id; o.status = "filled"; fills.push(fill); }
    }
  }
  return fills;
}

export function decayImpact(state: State): void {
  for (const c of Object.values(state.contracts)) {
    c.impact *= LIQUIDITY.impactDecayPerTick.value;
    if (Math.abs(c.impact) < INSTRUMENTS[c.inst].tick / 10) c.impact = 0;
  }
}

export function resetDailyVolume(state: State): void {
  for (const c of Object.values(state.contracts)) c.volumeToday = 0;
}

export function makeOrder(state: State, player: string, inst: InstrumentId, month: string, side: "buy" | "sell", qty: number, kind: Order["kind"], price: number | undefined, tag: LegTag, packageId?: string): Order {
  return { id: nextId(state, "order", "o"), player, inst, month, side, qty, kind, price, tag, packageId, placedTick: state.tick, status: "resting" };
}

export function hourNow(state: State): number { return hourOfTick(state.tick); }
export function dayNow(state: State): number { return dayOfTick(state.startDay, state.tick); }
