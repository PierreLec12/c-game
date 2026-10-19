/**
 * The action vocabulary and its validation (section 6). validate() returns a one-sentence refusal the
 * player can act on, or null; apply() mutates a state that has already passed validation.
 */
import { monthLabel } from "./calendar";
import { INSTRUMENTS, type InstrumentId } from "./refdata";
import type { Stream } from "./rng";
import type { Action, EngineEvent, LegTag, Order, State } from "./types";
import type { LevelSpec } from "./levels";
import { ckey, estimateFill, executeMarket, makeOrder, restOrder } from "./liquidity";
import { convertFx, drawLine, ledger, marginRequired, rebalanceMargin, repayLine } from "./finance";
import { applyFillToLots, feeRow, netLots } from "./pnl";

const ALWAYS: Action["type"][] = ["open_card", "ask_mentor", "answer_drill", "answer_quiz", "end_level"];

function usd(x: number): string { return (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString(); }

export function validateAction(state: State, spec: LevelSpec, a: Action): string | null {
  const L = state.level;
  if (L.status !== "running" && !["answer_quiz", "open_card", "ask_mentor"].includes(a.type)) return "the level has ended: open the debrief";
  if (!ALWAYS.includes(a.type) && !L.unlockedActions.includes(a.type)) return `${a.type.replace("_", " ")} is not available in this level yet`;
  switch (a.type) {
    case "order": {
      const r = validateLeg(state, a.inst, a.month, a.side, a.qty, a.kind);
      if (r) return r;
      if (a.kind !== "market") {
        if (a.price === undefined || !(a.price > 0)) return `a ${a.kind} order needs a price`;
        const q = state.quotes[ckey(a.inst, a.month)];
        if (a.kind === "limit" && q && q.open && ((a.side === "buy" && a.price >= q.ask) || (a.side === "sell" && a.price <= q.bid))) return `that limit would fill at once at the touch (${a.side === "buy" ? q.ask : q.bid}): send a market order, or rest it ${a.side === "buy" ? "below the ask" : "above the bid"}`;
        if (a.kind === "stop" && q && q.open && ((a.side === "buy" && a.price <= q.ask) || (a.side === "sell" && a.price >= q.bid))) return `a ${a.side} stop must sit ${a.side === "buy" ? "above the ask" : "below the bid"} (${a.side === "buy" ? q.ask : q.bid})`;
        return null;
      }
      return marginCheck(state, [{ inst: a.inst, month: a.month, side: a.side, qty: a.qty }]);
    }
    case "spread": {
      if (a.name === "crack321") {
        if (a.legs.length !== 3) return "a 3-2-1 crack has three legs: 2 RBOB, 1 ULSD, 3 WTI";
        const rb = a.legs.find((l) => l.inst === "RBOB"), ho = a.legs.find((l) => l.inst === "ULSD"), cl = a.legs.find((l) => l.inst === "WTI");
        if (!rb || !ho || !cl) return "a 3-2-1 crack has legs in RBOB, ULSD and WTI";
        if (rb.qty !== 2 * ho.qty || cl.qty !== 3 * ho.qty) return "a 3-2-1 crack is 2 RBOB and 1 ULSD against 3 WTI per unit";
        if (rb.side !== ho.side || rb.side === cl.side) return "the product legs face one way and the crude leg the other";
      } else {
        if (a.legs.length !== 2) return "a spread package has two legs";
        const [x, y] = a.legs;
        if (x.side === y.side) return "the two legs of a spread face opposite ways";
        if (a.name === "time" && (x.inst !== y.inst || x.month === y.month)) return "a time spread is one instrument, two months";
        if (a.name === "inter" && x.inst === y.inst) return "an inter-commodity spread is two instruments";
        if (x.qty !== y.qty) return "both legs of a spread take the same number of lots";
      }
      for (const l of a.legs) {
        const r = validateLeg(state, l.inst, l.month, l.side, l.qty, "market");
        if (r) return r;
      }
      return marginCheck(state, a.legs);
    }
    case "roll": {
      const net = netOf(state, a.inst, a.from);
      if (net === 0) return `no position in ${a.inst} ${monthLabel(a.from)} to roll`;
      if (!state.listed[a.inst].includes(a.to)) return `${a.inst} ${monthLabel(a.to)} is not listed`;
      if (a.to <= a.from) return "roll forward: the new month must be later than the old one";
      const side: "buy" | "sell" = net > 0 ? "sell" : "buy";
      const r = validateLeg(state, a.inst, a.from, side, Math.abs(net), "market") ?? validateLeg(state, a.inst, a.to, side === "buy" ? "sell" : "buy", Math.abs(net), "market");
      return r;
    }
    case "close": {
      const net = netOf(state, a.inst, a.month);
      if (net === 0) return `no position in ${a.inst} ${monthLabel(a.month)} to close`;
      return validateLeg(state, a.inst, a.month, net > 0 ? "sell" : "buy", Math.abs(net), "market");
    }
    case "cancel_order": {
      const o = state.orders.find((x) => x.id === a.orderId);
      if (!o) return `no order ${a.orderId}`;
      if (o.status !== "resting") return `order ${a.orderId} is ${o.status}`;
      return null;
    }
    case "draw_line": return a.amount > 0 ? (state.finance.lineDrawn + a.amount > state.finance.lineLimit + 1e-6 ? `the line has ${usd(state.finance.lineLimit - state.finance.lineDrawn)} available` : null) : "amount must be positive";
    case "repay_line": return a.amount > 0 ? (a.amount > state.finance.lineDrawn + 1e-6 ? `only ${usd(state.finance.lineDrawn)} is drawn` : a.amount > state.finance.cashUSD + 1e-6 ? `cash is ${usd(state.finance.cashUSD)}` : null) : "amount must be positive";
    case "post_margin": return state.finance.marginCall ? (a.amount > 0 ? null : "amount must be positive") : "there is no margin call to meet";
    case "convert_fx": return a.eur !== 0 ? null : "amount must be non-zero";
    case "open_card": return a.cardId ? null : "which card?";
    case "ask_mentor": return null;
    case "answer_drill": {
      const d = L.drills.find((x) => x.id === a.drillId);
      if (!d) return `no drill ${a.drillId}`;
      if (d.given !== undefined && d.correct) return "that drill is already right";
      return Number.isFinite(a.answer) ? null : "type a number";
    }
    case "answer_quiz": {
      if (L.status === "running") return "the quiz opens in the debrief, after the level ends";
      const q = L.quiz.find((x) => x.id === a.questionId);
      if (!q) return `no question ${a.questionId}`;
      if (q.given !== undefined) return "already answered";
      if (!Number.isInteger(a.choice) || a.choice < 0 || a.choice >= q.choices.length) return "pick one of the choices";
      return null;
    }
    case "end_level": return L.status === "running" ? null : "the level has already ended";
    case "request_limit": {
      if (!(a.value > 0)) return "the requested limit must be positive";
      if (!["var95", "grossLots", "netLots", "stopLoss"].includes(a.limit)) return "that limit cannot be changed";
      if (state.risk.closesTotal < 3) return "the risk manager wants three clean closes before discussing limits";
      if (state.risk.closesInsideLimit < state.risk.closesTotal || state.risk.livesLost > 0) return "the risk manager refuses: your track record this level has a breach in it";
      const current = a.limit === "netLots" ? Math.max(...Object.values(state.risk.limits.netLots)) : (state.risk.limits[a.limit] as number);
      if (a.value > current * 1.5) return `the risk manager will go to ${Math.round(current * 1.5).toLocaleString()} at most, not ${Math.round(a.value).toLocaleString()}`;
      return null;
    }
  }
  return "unknown action";
}

function netOf(state: State, inst: InstrumentId, month: string): number {
  return state.lots.filter((l) => l.inst === inst && l.month === month).reduce((a, l) => a + l.qty, 0);
}

function validateLeg(state: State, inst: InstrumentId, month: string, side: "buy" | "sell", qty: number, kind: Order["kind"]): string | null {
  if (!INSTRUMENTS[inst]) return `unknown instrument ${inst}`;
  if (!state.level.instruments.includes(inst)) return `${INSTRUMENTS[inst].name} is not traded in this level yet`;
  if (!state.listed[inst].includes(month)) return `${inst} ${month} is not listed; listed months run ${monthLabel(state.listed[inst][0])} to ${monthLabel(state.listed[inst][state.listed[inst].length - 1])}`;
  if (!Number.isInteger(qty) || qty <= 0) return "quantity must be a whole number of lots above zero";
  if (kind === "market") {
    const est = estimateFill(state, inst, month, side, qty);
    if (est.refusal) return est.refusal;
  } else if (side !== "buy" && side !== "sell") return "side must be buy or sell";
  return null;
}

/** Would the initial margin after these fills be fundable from cash plus the line? */
function marginCheck(state: State, legs: { inst: InstrumentId; month: string; side: "buy" | "sell"; qty: number }[]): string | null {
  // approximate: add the legs as new lots at the mid and recompute the requirement on a shallow copy
  const probe: State = { ...state, lots: state.lots.map((l) => ({ ...l })) };
  for (const l of legs) {
    const q = state.quotes[ckey(l.inst, l.month)];
    probe.lots.push({ id: "probe", inst: l.inst, month: l.month, qty: l.side === "buy" ? l.qty : -l.qty, entry: q.mid, openedTick: state.tick, tag: "outright", base: {}, baseFx: state.factors.eurusd, lastMark: q.mid });
  }
  const need = marginRequired(probe).total;
  const have = state.finance.marginAccount + state.finance.cashUSD + (state.finance.lineCut ? 0 : state.finance.lineLimit - state.finance.lineDrawn);
  if (need > have + 1e-6) return `initial margin would be ${usd(need)}; cash, margin held and the line together cover ${usd(have)}`;
  return null;
}

export function applyAction(state: State, spec: LevelSpec, a: Action, s: Stream): EngineEvent[] {
  const events: EngineEvent[] = [];
  const L = state.level;
  switch (a.type) {
    case "order": {
      const o = makeOrder(state, a.player, a.inst, a.month, a.side, a.qty, a.kind, a.price, a.tag ?? "outright");
      if (a.kind === "market") events.push(...fillMarket(state, o));
      else {
        restOrder(state, o);
        events.push({ kind: "order_rested", tick: state.tick, text: `${a.kind === "limit" ? "Limit" : "Stop"} ${a.side} ${a.qty} ${INSTRUMENTS[a.inst].name} ${monthLabel(a.month)} at ${a.price} is resting`, data: { orderId: o.id } });
      }
      break;
    }
    case "spread": {
      const pk = `pk${state.counters.order + 1}`;
      const tag: LegTag = a.name === "time" ? "time_spread" : a.name === "inter" ? "inter_commodity" : "crack";
      for (const l of a.legs) {
        const o = makeOrder(state, a.player, l.inst, l.month, l.side, l.qty, "market", undefined, tag, pk);
        events.push(...fillMarket(state, o));
      }
      break;
    }
    case "roll": {
      const net = netOf(state, a.inst, a.from);
      const pk = `roll${state.counters.order + 1}`;
      const closeSide: "buy" | "sell" = net > 0 ? "sell" : "buy";
      events.push(...fillMarket(state, makeOrder(state, a.player, a.inst, a.from, closeSide, Math.abs(net), "market", undefined, "roll", pk)));
      events.push(...fillMarket(state, makeOrder(state, a.player, a.inst, a.to, closeSide === "buy" ? "sell" : "buy", Math.abs(net), "market", undefined, "roll", pk)));
      break;
    }
    case "close": {
      const net = netOf(state, a.inst, a.month);
      events.push(...fillMarket(state, makeOrder(state, a.player, a.inst, a.month, net > 0 ? "sell" : "buy", Math.abs(net), "market", undefined, "outright")));
      break;
    }
    case "cancel_order": {
      const o = state.orders.find((x) => x.id === a.orderId)!;
      o.status = "cancelled";
      events.push({ kind: "order_cancelled", tick: state.tick, text: `Order ${o.id} cancelled`, data: { orderId: o.id } });
      break;
    }
    case "draw_line": { const r = drawLine(state, a.amount); if (r) events.push({ kind: "news", tick: state.tick, text: r }); break; }
    case "repay_line": { const r = repayLine(state, a.amount); if (r) events.push({ kind: "news", tick: state.tick, text: r }); break; }
    case "post_margin": {
      const call = state.finance.marginCall!;
      const draw = Math.min(a.amount, state.finance.lineCut ? 0 : state.finance.lineLimit - state.finance.lineDrawn);
      if (draw > 0) drawLine(state, draw);
      if (state.finance.cashUSD >= -0.005) { state.finance.marginCall = null; events.push({ kind: "margin_met", tick: state.tick, text: `Margin call of ${usd(call.amount)} met` }); }
      else events.push({ kind: "news", tick: state.tick, text: `Still ${usd(-state.finance.cashUSD)} short of the call: reduce the book to release margin` });
      break;
    }
    case "convert_fx": { const r = convertFx(state, a.eur); if (r) events.push({ kind: "news", tick: state.tick, text: r }); break; }
    case "open_card": if (!L.cardsOpened.includes(a.cardId)) L.cardsOpened.push(a.cardId); break;
    case "ask_mentor": {
      const line = spec.askMentor ? spec.askMentor(state, a.topic) : "Ask me about something on the screen.";
      L.mentorLines.push({ tick: state.tick, text: line });
      events.push({ kind: "mentor", tick: state.tick, text: line });
      break;
    }
    case "answer_drill": {
      const d = L.drills.find((x) => x.id === a.drillId)!;
      d.given = a.answer;
      d.correct = Math.abs(a.answer - d.answer) <= d.tolerance + 1e-9;
      events.push({ kind: "drill", tick: state.tick, text: d.correct ? `Right: ${d.working}` : `Not quite. ${d.working}`, data: { correct: d.correct, drillId: d.id } });
      break;
    }
    case "answer_quiz": {
      const q = L.quiz.find((x) => x.id === a.questionId)!;
      q.given = a.choice;
      events.push({ kind: "quiz", tick: state.tick, text: a.choice === q.correct ? `Right. ${q.explanation}` : `No. ${q.explanation}`, data: { correct: a.choice === q.correct } });
      break;
    }
    case "end_level": L.endTick = state.tick; break;
    case "request_limit": {
      if (a.limit === "netLots") for (const k of Object.keys(state.risk.limits.netLots) as InstrumentId[]) state.risk.limits.netLots[k] = a.value;
      else (state.risk.limits as unknown as Record<string, number>)[a.limit] = a.value;
      const text = `Limit ${a.limit} raised to ${Math.round(a.value).toLocaleString()} on your track record this level.`;
      state.risk.messages.push({ tick: state.tick, text, severity: "info" });
      events.push({ kind: "news", tick: state.tick, text });
      break;
    }
  }
  void s;
  return events;
}

/** Execute a market order and book its consequences: fill, fees, lots, margin. */
export function fillMarket(state: State, o: Order): EngineEvent[] {
  const { fill, refusal } = executeMarket(state, o);
  if (!fill) return [{ kind: "news", tick: state.tick, text: `Order refused: ${refusal}` }];
  const spec = INSTRUMENTS[fill.inst];
  ledger(state, "fee", -fill.fees, `Fees on ${fill.qty} lots of ${spec.name} ${monthLabel(fill.month)}`);
  state.pnl.fees += fill.fees;
  state.pnl.attribution.push(feeRow(state, fill));
  const { realised, rows } = applyFillToLots(state, fill);
  state.pnl.attribution.push(...rows);
  const notes = rebalanceMargin(state);
  const touch = fill.side === "buy" ? "ask" : "bid";
  const touchPx = fill.side === "buy" ? fill.mid + (fill.price - fill.slippage - fill.mid) : fill.mid - (fill.mid - fill.price - fill.slippage);
  const text = `${fill.side === "buy" ? "Bought" : "Sold"} ${fill.qty} ${spec.name} ${monthLabel(fill.month)} at ${fill.price.toFixed(spec.decimals)} (${touch} ${touchPx.toFixed(spec.decimals)}${fill.slippage > 0 ? ` + ${fill.slippage.toFixed(spec.decimals)} slippage` : ""}); fees $${fill.fees.toFixed(0)}${realised !== 0 ? `; realised ${usd(realised)}` : ""}${notes.length ? `; ${notes.join("; ")}` : ""}`;
  return [{ kind: "fill", tick: state.tick, text, data: { fillId: fill.id, inst: fill.inst, month: fill.month, side: fill.side, qty: fill.qty, price: fill.price, realised } }];
}

export function netPositions(state: State): Record<InstrumentId, number> { return netLots(state); }
