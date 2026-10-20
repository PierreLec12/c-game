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
import { attachSale, cargoFromOffer, efpFix, legMark, remarkCargo, chargeCargo, prepayCargo, isPipeline } from "./physical";
import { insureCargo, lineAvailable, openLc } from "./finance";
import { decideCounter, rememberDispute } from "./counterparties";
import { blendParcels, chargeTanks, drawParcel, leaseTank, releaseTank, storeCargo, tankInventory } from "./storage";
import { STORAGE_TANKS } from "./world_data";
import { charterQuotes, etaTick, planLegs } from "./shipping";
import { divert, passageDecision } from "./voyages";
import { COUNTERPARTIES, GRADES, PORTS, SHIPPING } from "./world_data";
import { formatClock } from "./calendar";
import { STRATEGY_STRIKES, estimateOptionFill, executeOption, isListedStrike, listedStrikes, makeOptionOrder, optionExpiryTick, strategyLegs } from "./optionbook";
import { SLATES, refineryMarginPerBbl } from "./refinery";
import { OPTIONS, SIGNALS } from "./refdata";
import { unitOf } from "./physical";

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
    case "accept_tender": {
      const t = state.tenders.find((x) => x.id === a.tenderId);
      if (!t) return `no tender ${a.tenderId}`;
      if (t.status !== "open") return `tender ${t.id} is ${t.status}`;
      if (t.expiresTick <= state.tick) return `tender ${t.id} has expired`;
      if (t.side === "offer") {
        if (t.laycan[0] * 24 < state.tick) return "the laycan has already started";
        if (a.prepay) {
          if (!(t.prepayDiscount > 0)) return `${COUNTERPARTIES[t.counterparty].name} is not offering a prepayment discount`;
          const est = (state.factors.brentPrompt + t.diff) * t.bbl;
          if (est > state.finance.cashUSD + lineAvailable(state) + 1e-6) return `prepaying about ${usd(est)} needs cash or line you do not have (${usd(state.finance.cashUSD + lineAvailable(state))} available)`;
        }
        return null;
      }
      const cargo = state.cargoes.find((c) => c.id === a.cargoId);
      if (!cargo) return "a bid needs one of your cargoes: pick the cargo to sell";
      if (cargo.grade !== t.grade) return `${COUNTERPARTIES[t.counterparty].name} bids for ${GRADES[t.grade].name}, not ${GRADES[cargo.grade].name}`;
      if (cargo.sale) return `${cargo.id} is already sold`;
      if (cargo.status === "cancelled") return `${cargo.id} was cancelled`;
      if ((cargo.status === "delivered" || cargo.status === "discharging") && cargo.tankId === null) return `${cargo.id} has already been discharged and is not in a tank`;
      if (cargo.tankId !== null && t.port !== state.tanks.find((k) => k.id === cargo.tankId)?.port) return `${cargo.id} sits in a tank at ${PORTS[state.tanks.find((k) => k.id === cargo.tankId)!.port].name}; this bid is for ${PORTS[t.port].name}`;
      if (cargo.tankId !== null && !state.tanks.find((k) => k.id === cargo.tankId)!.parcels.some((p) => p.id === cargo.parcelId && p.grade !== "BLEND")) return `${cargo.id}'s parcel was blended; a blend is marked on the grid but cannot be tendered yet`;
      if (Math.abs(cargo.bbl - t.bbl) > 0.15 * t.bbl) return `the bid is for ${t.bbl.toLocaleString()} bbl; your cargo is ${cargo.bbl.toLocaleString()}`;
      return null;
    }
    case "decline_tender": {
      const t = state.tenders.find((x) => x.id === a.tenderId);
      if (!t) return `no tender ${a.tenderId}`;
      if (t.status !== "open") return `tender ${t.id} is ${t.status}`;
      return null;
    }
    case "fix_charter": {
      const cargo = state.cargoes.find((c) => c.id === a.cargoId);
      if (!cargo) return `no cargo ${a.cargoId}`;
      if (cargo.vesselId) return `${cargo.id} already has ${state.vessels.find((v) => v.id === cargo.vesselId)?.name}`;
      const q = charterQuotes(state, cargo).find((x) => x.vesselId === a.vesselId);
      if (!q) return "that vessel is not available";
      if (!q.fits) return q.why.split(". ").slice(-1)[0];
      if (q.etaLoadDay > cargo.laycan[1]) return `${q.vessel} would reach ${PORTS[cargo.loadPort].name} on day ${q.etaLoadDay}, after the laycan ends on day ${cargo.laycan[1]}`;
      return null;
    }
    case "instruct_ship": {
      const cargo = state.cargoes.find((c) => c.id === a.cargoId);
      if (!cargo) return `no cargo ${a.cargoId}`;
      const v = state.voyages.find((x) => x.id === cargo.voyageId);
      if (!v || v.status === "done") return `${cargo.id} has no ship under way`;
      if (a.speedFactor !== undefined && (a.speedFactor < SHIPPING.slowSteamMin.value || a.speedFactor > 1)) return `speed must be between ${Math.round(SHIPPING.slowSteamMin.value * 100)}% and 100% of service speed`;
      if (a.passage !== undefined && v.status !== "waiting_chokepoint") return "the ship is not waiting at a passage";
      if (a.passage !== undefined && v.waitUntil !== null) return "the ship is already waiting for its convoy; the decision is made";
      if (a.anchorDays !== undefined && (a.anchorDays < 0 || a.anchorDays > 60)) return "anchor days must be between 0 and 60";
      if (a.anchorDays !== undefined && (v.status === "discharging" || v.status === "waiting_berth")) return "too late to anchor: the ship has tendered notice of readiness";
      return null;
    }
    case "efp": {
      const cargo = state.cargoes.find((c) => c.id === a.cargoId);
      if (!cargo) return `no cargo ${a.cargoId}`;
      const leg = a.leg === "purchase" ? cargo.purchase : cargo.sale;
      if (!leg) return `${cargo.id} has no ${a.leg} leg`;
      if (leg.fixed !== null) return `the ${a.leg} is already priced`;
      if (!leg.windowDays && a.leg === "purchase" && cargo.blTick === null) return "an EFP needs the window anchored: wait for the bill of lading";
      return null;
    }
    case "settle_claim":
    case "contest_claim": {
      const cargo = state.cargoes.find((c) => c.id === a.cargoId);
      if (!cargo) return `no cargo ${a.cargoId}`;
      const claim = cargo.claims.find((c) => c.id === a.claimId);
      if (!claim) return `no claim ${a.claimId}`;
      if (claim.status !== "open") return `claim ${claim.id} is ${claim.status}`;
      return null;
    }
    case "open_lc": {
      const cargo = state.cargoes.find((c) => c.id === a.cargoId);
      if (!cargo) return `no cargo ${a.cargoId}`;
      if (cargo.lcId) return `${cargo.id} already has ${cargo.lcId}`;
      if (cargo.status !== "contracted" && cargo.status !== "fixed") return `too late: ${cargo.id} is ${cargo.status}`;
      const face = legMark(state, cargo, cargo.purchase).perBbl * cargo.bbl;
      if (face > lineAvailable(state) + 1e-6) return `a letter of credit for ${usd(face)} needs that much of the line; ${usd(lineAvailable(state))} is available`;
      return null;
    }
    case "insure": {
      const cargo = state.cargoes.find((c) => c.id === a.cargoId);
      if (!cargo) return `no cargo ${a.cargoId}`;
      if (cargo.insured) return `${cargo.id} is already insured`;
      if (cargo.status === "cancelled" || cargo.status === "delivered") return `too late: ${cargo.id} is ${cargo.status}`;
      return null;
    }
    case "counter_tender": {
      const t = state.tenders.find((x) => x.id === a.tenderId);
      if (!t) return `no tender ${a.tenderId}`;
      if (t.status !== "open") return `tender ${t.id} is ${t.status}`;
      if (t.countered) return `${COUNTERPARTIES[t.counterparty].name} has already answered a counter on ${t.id}`;
      if (!Number.isFinite(a.diff)) return "a counter needs a differential";
      return null;
    }
    case "lease_tank": {
      const spec = STORAGE_TANKS[a.port];
      if (!spec) return `no tanks to lease at ${a.port}`;
      if (!(a.bbl >= 50000)) return "lease at least 50,000 bbl";
      const leased = state.tanks.filter((t) => t.port === a.port && !t.released).reduce((x, t) => x + t.capacityBbl, 0);
      if (leased + a.bbl > spec.capacityBbl.value) return `${PORTS[a.port].name} has ${(spec.capacityBbl.value - leased).toLocaleString()} bbl left to lease`;
      if (!(a.months >= spec.minMonths.value)) return `the minimum term at ${PORTS[a.port].name} is ${spec.minMonths.value} month${spec.minMonths.value > 1 ? "s" : ""}`;
      return null;
    }
    case "store_cargo": {
      const cargo = state.cargoes.find((c) => c.id === a.cargoId);
      if (!cargo) return `no cargo ${a.cargoId}`;
      const tank = state.tanks.find((t) => t.id === a.tankId && !t.released);
      if (!tank) return `no tank ${a.tankId}`;
      if (cargo.status !== "delivered") return `${cargo.id} is ${cargo.status}: oil goes into a tank once it is delivered`;
      if (cargo.tankId) return `${cargo.id} is already in ${cargo.tankId}`;
      if (cargo.sale) return `${cargo.id} is sold: the receiver takes it`;
      const at = isPipeline(cargo) ? cargo.loadPort : cargo.dischargePort;
      if (tank.port !== at) return `${cargo.id} is at ${PORTS[at].name}; tank ${tank.id} is at ${PORTS[tank.port].name}`;
      if (tankInventory(tank) + cargo.bbl > tank.capacityBbl + 1e-6) return `tank ${tank.id} has ${(tank.capacityBbl - tankInventory(tank)).toLocaleString()} bbl of room`;
      return null;
    }
    case "blend": {
      const tank = state.tanks.find((t) => t.id === a.tankId && !t.released);
      if (!tank) return `no tank ${a.tankId}`;
      if (!Array.isArray(a.parcelIds) || a.parcelIds.length < 2) return "blend at least two parcels";
      if (!a.parcelIds.every((id) => tank.parcels.some((p) => p.id === id))) return "every parcel must be in that tank";
      if (state.cargoes.some((c) => c.sale && c.parcelId && a.parcelIds.includes(c.parcelId))) return "a parcel sold forward cannot be blended";
      return null;
    }
    case "release_tank": {
      const tank = state.tanks.find((t) => t.id === a.tankId && !t.released);
      if (!tank) return `no tank ${a.tankId}`;
      if (tankInventory(tank) > 0) return `tank ${tank.id} still holds ${tankInventory(tank).toLocaleString()} bbl`;
      if (state.cargoes.some((c) => c.tankId === tank.id && c.sale && c.sale.paidTick === null)) return `tank ${tank.id} holds oil sold forward until that sale is delivered and paid`;
      return null;
    }
    case "option_order": {
      if (!state.level.instruments.includes(a.inst)) return `${INSTRUMENTS[a.inst]?.name ?? a.inst} is not traded in this level yet`;
      const est = estimateOptionFill(state, a.inst, a.month, a.kind, a.strike, a.side, a.qty);
      if (est.refusal) return est.refusal;
      return marginCheck(state, [], [{ inst: a.inst, month: a.month, kind: a.kind, strike: a.strike, side: a.side, qty: a.qty }]);
    }
    case "option_strategy": {
      if (!state.level.instruments.includes(a.inst)) return `${INSTRUMENTS[a.inst]?.name ?? a.inst} is not traded in this level yet`;
      const need = STRATEGY_STRIKES[a.name];
      if (need === undefined) return `unknown strategy ${a.name}`;
      if (!Array.isArray(a.strikes) || a.strikes.length !== need) return `a ${a.name.replace("_", " ")} takes ${need} strike${need > 1 ? "s" : ""}`;
      if (need === 2 && a.strikes[0] === a.strikes[1]) return "the two strikes must differ";
      const legs = strategyLegs(a.name, a.strikes, a.side);
      for (const l of legs) { const est = estimateOptionFill(state, a.inst, a.month, l.kind, l.strike, l.side, a.qty); if (est.refusal) return `${l.strike} ${l.kind}: ${est.refusal}`; }
      return marginCheck(state, [], legs.map((l) => ({ inst: a.inst, month: a.month, kind: l.kind, strike: l.strike, side: l.side, qty: a.qty })));
    }
    case "set_runs": {
      if (!state.refinery) return "there is no refinery in this level";
      if (!(a.runs >= 0 && a.runs <= 1)) return "runs are a share of capacity between 0 and 1";
      return null;
    }
    case "set_slate": {
      if (!state.refinery) return "there is no refinery in this level";
      if (!SLATES.includes(a.grade as (typeof SLATES)[number])) return `the plant runs ${SLATES.map((g) => GRADES[g].name).join(" or ")}`;
      if (state.refinery.slate === a.grade && !state.refinery.pendingSlate) return `the plant is already on ${GRADES[a.grade].name}`;
      return null;
    }
    case "book_regas": {
      const cargo = state.cargoes.find((c) => c.id === a.cargoId);
      if (!cargo) return `no cargo ${a.cargoId}`;
      if (cargo.grade !== "LNG") return "regasification slots are for LNG cargoes";
      if (cargo.regasBooked) return `${cargo.id} already has a slot at ${PORTS[cargo.dischargePort].name}`;
      if (cargo.status === "delivered" || cargo.status === "discharging" || cargo.status === "cancelled") return `too late: ${cargo.id} is ${cargo.status}`;
      const v = state.voyages.find((x) => x.id === cargo.voyageId);
      if (v && v.norTick !== null) return "too late: the ship has tendered notice of readiness";
      return null;
    }
    case "buy_feed": {
      if (state.feedBought) return "the feed is already on";
      if (state.finance.cashUSD + lineAvailable(state) < SIGNALS.feedCostUsd.value) return `the feed costs ${usd(SIGNALS.feedCostUsd.value)}; cash and line together cover ${usd(state.finance.cashUSD + lineAvailable(state))}`;
      return null;
    }
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
function marginCheck(state: State, legs: { inst: InstrumentId; month: string; side: "buy" | "sell"; qty: number }[], options: { inst: InstrumentId; month: string; kind: "call" | "put"; strike: number; side: "buy" | "sell"; qty: number }[] = []): string | null {
  // approximate: add the legs as new lots at the mid and recompute the requirement on a shallow copy
  const probe: State = { ...state, lots: state.lots.map((l) => ({ ...l })) };
  for (const l of legs) {
    const q = state.quotes[ckey(l.inst, l.month)];
    probe.lots.push({ id: "probe", inst: l.inst, month: l.month, qty: l.side === "buy" ? l.qty : -l.qty, entry: q.mid, openedTick: state.tick, tag: "outright", base: {}, baseFx: state.factors.eurusd, lastMark: q.mid });
  }
  for (const o of options) {
    const q = state.quotes[ckey(o.inst, o.month)];
    probe.lots.push({ id: "probe", inst: o.inst, month: o.month, qty: o.side === "buy" ? o.qty : -o.qty, entry: 0, openedTick: state.tick, tag: "option", base: {}, baseFx: state.factors.eurusd, lastMark: 0, option: { kind: o.kind, strike: o.strike, expiryTick: optionExpiryTick(state, o.inst, o.month), base: { F: q.mid, sigma: 0.3, T: 0.1 } } });
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
      // a calendar spread trades in the spread book, which is deeper than the outright book (stylised: four times)
      const saved: Record<string, typeof state.quotes[string]> = {};
      if (a.name === "time") for (const l of a.legs) { const k = ckey(l.inst, l.month); saved[k] = state.quotes[k]; state.quotes[k] = { ...state.quotes[k], depth: state.quotes[k].depth * 4 }; }
      for (const l of a.legs) {
        const o = makeOrder(state, a.player, l.inst, l.month, l.side, l.qty, "market", undefined, tag, pk);
        events.push(...fillMarket(state, o));
      }
      for (const [k, q] of Object.entries(saved)) state.quotes[k] = { ...state.quotes[k], depth: q.depth };
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
    case "accept_tender": {
      const t = state.tenders.find((x) => x.id === a.tenderId)!;
      t.status = "accepted";
      if (t.side === "offer") {
        const cargo = cargoFromOffer(state, t);
        state.cargoes.push(cargo);
        let prepayNote = "";
        if (a.prepay && t.prepayDiscount > 0) {
          const amount = prepayCargo(state, cargo, t.prepayDiscount);
          fund(state, amount);
          ledger(state, "other", -amount, `Prepaid ${usd(amount)} to ${COUNTERPARTIES[t.counterparty].name} for ${GRADES[cargo.grade].name} ${cargo.id} (differential ${t.prepayDiscount.toFixed(2)} better)`);
          prepayNote = ` Prepaid ${usd(amount)}: the differential is ${cargo.purchase.diff >= 0 ? "+" : ""}${cargo.purchase.diff.toFixed(2)}, and the line carries the money until the invoice.`;
        }
        const cs = state.counterparties[t.counterparty];
        if (cs) cs.dealsWithPlayer += 1;
        const rows = remarkCargo(state, cargo, "accepted");
        state.pnl.attribution.push(...rows);
        const m = rows.reduce((x, r) => x + r.amount, 0);
        const text = `Bought ${cargo.bbl.toLocaleString()} bbl of ${GRADES[cargo.grade].name} ${cargo.purchase.incoterm} ${PORTS[cargo.loadPort].name} from ${COUNTERPARTIES[t.counterparty].name} at ${t.basis} ${cargo.purchase.diff >= 0 ? "+" : ""}${cargo.purchase.diff.toFixed(2)}, laycan days ${t.laycan[0]}-${t.laycan[1]}. Marked at ${usd(m)} against the market${isPipeline(cargo) ? "" : " (unsold, freight unfixed). Fix a ship on the Desk"}.${cargo.requiresLc ? " The seller wants a letter of credit before loading: open one on Finance." : ""}${prepayNote}`;
        events.push({ kind: "cargo", tick: state.tick, text, data: { cargoId: cargo.id }, pause: true });
      } else {
        const cargo = state.cargoes.find((c) => c.id === a.cargoId)!;
        const before = cargo.dischargePort;
        attachSale(state, cargo, t);
        const v = state.voyages.find((x) => x.id === cargo.voyageId);
        if (v && cargo.dischargePort !== before && v.status !== "done") events.push(...divert(state, v, cargo.dischargePort));
        if (cargo.tankId) {
          // the stored barrels are committed to the sale: the parcel leaves the tank's mark and the sale leg carries them
          const tank = state.tanks.find((k) => k.id === cargo.tankId)!;
          const d = drawParcel(state, tank, cargo.parcelId!, cargo.bbl);
          state.pnl.attribution.push(...d.rows);
          cargo.parcelId = null;
        }
        const rows = remarkCargo(state, cargo, "sold");
        state.pnl.attribution.push(...rows);
        events.push({ kind: "cargo", tick: state.tick, text: `Sold ${GRADES[cargo.grade].name} ${cargo.id} ${t.incoterm} ${PORTS[t.port].name} to ${COUNTERPARTIES[t.counterparty].name} at ${t.basis} ${t.diff >= 0 ? "+" : ""}${t.diff.toFixed(2)}, pricing ${cargo.sale!.window.kind === "after_discharge" ? `${cargo.sale!.window.days ?? 5} days after discharge` : cargo.sale!.window.kind === "after_bl" ? `${cargo.sale!.window.days ?? 5} days after B/L` : cargo.sale!.window.kind}. Discharge window days ${t.laycan[0]}-${t.laycan[1]}.`, data: { cargoId: cargo.id }, pause: true });
      }
      break;
    }
    case "decline_tender": {
      const t = state.tenders.find((x) => x.id === a.tenderId)!;
      t.status = "declined";
      t.declineReason = a.reason ?? null;
      events.push({ kind: "tender", tick: state.tick, text: `Declined ${t.id} from ${COUNTERPARTIES[t.counterparty].name}${a.reason ? `: ${a.reason}` : "."}`, data: { tenderId: t.id } });
      break;
    }
    case "open_lc": {
      const cargo = state.cargoes.find((c) => c.id === a.cargoId)!;
      const face = legMark(state, cargo, cargo.purchase).perBbl * cargo.bbl;
      const r = openLc(state, cargo, face);
      if (r.lc) events.push({ kind: "finance", tick: state.tick, text: `Opened ${r.lc.id} for ${usd(face)} in favour of ${COUNTERPARTIES[cargo.purchase.counterparty].name}: fee ${usd(r.lc.feeUsd)}; the line has ${usd(lineAvailable(state))} left.`, data: { cargoId: cargo.id } });
      else events.push({ kind: "news", tick: state.tick, text: r.refusal ?? "could not open the letter of credit" });
      break;
    }
    case "insure": {
      const cargo = state.cargoes.find((c) => c.id === a.cargoId)!;
      const value = legMark(state, cargo, cargo.purchase).perBbl * cargo.bbl;
      const premium = insureCargo(state, cargo, value);
      events.push({ kind: "finance", tick: state.tick, text: `Insured ${GRADES[cargo.grade].name} ${cargo.id} against non-performance for ${usd(premium)}.`, data: { cargoId: cargo.id } });
      break;
    }
    case "counter_tender": {
      const t = state.tenders.find((x) => x.id === a.tenderId)!;
      const d = decideCounter(state, t.id, a.diff);
      t.countered = { diff: a.diff, answer: d.accepted ? "accepted" : "declined", tick: state.tick };
      if (d.accepted) { t.diff = a.diff; t.note = `${t.note} Countered to ${a.diff >= 0 ? "+" : ""}${a.diff.toFixed(2)} and accepted.`; }
      events.push({ kind: "tender", tick: state.tick, text: d.text, data: { tenderId: t.id }, pause: true });
      break;
    }
    case "lease_tank": {
      const tank = leaseTank(state, a.port, a.bbl, a.months);
      state.pnl.attribution.push(...chargeTanks(state));
      events.push({ kind: "storage", tick: state.tick, text: `Leased tank ${tank.id} at ${PORTS[a.port].name}: ${a.bbl.toLocaleString()} bbl for ${a.months} month${a.months > 1 ? "s" : ""} at ${tank.costPerBblMonth.toFixed(2)} ${tank.currency}/bbl/month; the first month is paid.`, data: { tankId: tank.id } });
      break;
    }
    case "store_cargo": {
      const cargo = state.cargoes.find((c) => c.id === a.cargoId)!;
      const tank = state.tanks.find((t) => t.id === a.tankId)!;
      const r = storeCargo(state, cargo, tank);
      state.pnl.attribution.push(...r.rows);
      events.push({ kind: "storage", tick: state.tick, text: `${GRADES[cargo.grade].name} ${cargo.id}: ${cargo.bbl.toLocaleString()} bbl into tank ${tank.id} at ${PORTS[tank.port].name} as parcel ${r.parcel.id}, marked at the ${r.parcel.benchmark} prompt.`, data: { cargoId: cargo.id, tankId: tank.id } });
      break;
    }
    case "blend": {
      const tank = state.tanks.find((t) => t.id === a.tankId)!;
      const r = blendParcels(state, tank, a.parcelIds);
      state.pnl.attribution.push(...r.rows);
      events.push({ kind: "storage", tick: state.tick, text: r.rows[0]?.text ?? `Blended into ${r.parcel.label}.`, data: { tankId: tank.id, parcelId: r.parcel.id }, pause: true });
      break;
    }
    case "release_tank": {
      const tank = state.tanks.find((t) => t.id === a.tankId)!;
      const r = releaseTank(state, tank);
      events.push({ kind: "storage", tick: state.tick, text: r ?? `Released tank ${tank.id} at ${PORTS[tank.port].name}.`, data: { tankId: tank.id } });
      break;
    }
    case "fix_charter": {
      const cargo = state.cargoes.find((c) => c.id === a.cargoId)!;
      const q = charterQuotes(state, cargo).find((x) => x.vesselId === a.vesselId)!;
      const vessel = state.vessels.find((v) => v.id === a.vesselId)!;
      const legs = planLegs(state, vessel, cargo)!;
      const voyage = { id: `V${++state.counters.voyage}`, vesselId: vessel.id, cargoId: cargo.id, legs, legIndex: 0, nmDone: 0, speedFactor: 1, status: "ballast" as const, hireUsdPerDay: q.hireUsdPerDay, lumpUsd: q.lumpUsd, eta: 0, blockedAt: null, waitUntil: null, anchorUntil: null, norTick: null, berthTick: null, detour: null, cleared: [], decision: null, loadEnd: null, dischargeEnd: null, trail: [] };
      voyage.eta = etaTick(state, voyage);
      state.voyages.push(voyage);
      vessel.status = "ballast"; vessel.voyageId = voyage.id; vessel.atPort = null;
      cargo.vesselId = vessel.id; cargo.voyageId = voyage.id; cargo.status = "fixed";
      cargo.freight.fixedUsd = q.lumpUsd;
      const rows = remarkCargo(state, cargo, "charter fixed");
      state.pnl.attribution.push(...rows);
      events.push({ kind: "voyage", tick: state.tick, text: `Fixed ${vessel.name} (${q.cls}, ${q.owner}) for ${GRADES[cargo.grade].name} ${cargo.id}: ${usd(q.lumpUsd)} lump sum, ${q.usdPerBbl.toFixed(2)} $/bbl. Ballast ${q.ballastDays.toFixed(1)} days to ${PORTS[cargo.loadPort].name} (day ${q.etaLoadDay}), laden ${q.ladenDays.toFixed(1)} days to ${PORTS[cargo.dischargePort].name}; ETA ${formatClock(state.startDay, voyage.eta)}.`, data: { cargoId: cargo.id, voyageId: voyage.id }, pause: true });
      break;
    }
    case "instruct_ship": {
      const cargo = state.cargoes.find((c) => c.id === a.cargoId)!;
      const v = state.voyages.find((x) => x.id === cargo.voyageId)!;
      const vessel = state.vessels.find((x) => x.id === v.vesselId)!;
      if (a.speedFactor !== undefined) {
        v.speedFactor = a.speedFactor;
        v.eta = etaTick(state, v);
        events.push({ kind: "voyage", tick: state.tick, text: `${vessel.name} now at ${Math.round(a.speedFactor * 100)}% of service speed. ETA ${formatClock(state.startDay, v.eta)}.`, data: { voyageId: v.id } });
      }
      if (a.anchorDays !== undefined) {
        const arrival = v.status === "anchored" ? state.tick : etaTick(state, v);
        v.anchorUntil = a.anchorDays > 0 ? arrival + a.anchorDays * 24 : null;
        if (v.status === "anchored" && v.anchorUntil === null) v.anchorUntil = state.tick;
        events.push({ kind: "voyage", tick: state.tick, text: a.anchorDays > 0 ? `${vessel.name} will hold at anchor off ${PORTS[cargo.dischargePort].name} for ${a.anchorDays} days after arrival: storage on water at ${usd(v.hireUsdPerDay)} a day.` : `${vessel.name} will tender notice of readiness on arrival.`, data: { voyageId: v.id } });
      }
      if (a.passage !== undefined) {
        const r = passageDecision(state, v, a.passage);
        state.pnl.attribution.push(...r.rows);
        events.push(...r.events);
      }
      const rows = remarkCargo(state, cargo, "instruction");
      state.pnl.attribution.push(...rows);
      break;
    }
    case "efp": {
      const cargo = state.cargoes.find((c) => c.id === a.cargoId)!;
      const legBefore = a.leg === "purchase" ? cargo.purchase : cargo.sale!;
      const m = legMark(state, cargo, legBefore);
      const unpricedBbl = (cargo.bbl * m.unpriced.length) / m.n;
      const r = efpFix(state, cargo, a.leg)!;
      // the paper side: close futures of the same size at the mid, no spread crossed
      const inst = legBefore.basis === "DUBAI" ? "DUBAI" : legBefore.basis === "WTI" ? "WTI" : "BRENT";
      const month = state.listed[inst][0];
      const net = netOf(state, inst, month);
      const wanted = Math.round(unpricedBbl / 1000);
      const closable = Math.min(wanted, Math.abs(net));
      if (closable > 0) {
        const q = state.quotes[ckey(inst, month)];
        state.quotes[ckey(inst, month)] = { ...q, bid: q.mid, ask: q.mid, depth: 1e9 };
        events.push(...fillMarket(state, makeOrder(state, a.player, inst, month, net > 0 ? "sell" : "buy", closable, "market", undefined, "hedge")));
        state.quotes[ckey(inst, month)] = q;
      }
      const rows = remarkCargo(state, cargo, "EFP");
      state.pnl.attribution.push(...rows);
      events.push({ kind: "cargo", tick: state.tick, text: `EFP on ${GRADES[cargo.grade].name} ${cargo.id} ${a.leg}: ${Math.round(r.fixedBbl).toLocaleString()} bbl fixed at ${r.price.toFixed(2)} ${legBefore.basis}${closable > 0 ? `, ${closable} ${inst} lots exchanged at the mid` : ", no paper held against it"}.`, data: { cargoId: cargo.id }, pause: true });
      break;
    }
    case "settle_claim": {
      const cargo = state.cargoes.find((c) => c.id === a.cargoId)!;
      const claim = cargo.claims.find((c) => c.id === a.claimId)!;
      claim.status = "settled"; claim.resolvedTick = state.tick;
      state.pnl.attribution.push(chargeCargo(state, cargo, "quality", claim.amountUsd, `${GRADES[cargo.grade].name} ${cargo.id}: ${claim.kind} claim from ${COUNTERPARTIES[claim.from]?.name ?? claim.from} settled for ${usd(claim.amountUsd)}.`));
      events.push({ kind: "claim", tick: state.tick, text: `Settled the ${claim.kind} claim on ${cargo.id} for ${usd(claim.amountUsd)}.`, data: { cargoId: cargo.id } });
      break;
    }
    case "contest_claim": {
      const cargo = state.cargoes.find((c) => c.id === a.cargoId)!;
      const claim = cargo.claims.find((c) => c.id === a.claimId)!;
      const won = s.chance(0.5);
      rememberDispute(state, cargo.sale?.counterparty ?? claim.from, `a contested ${claim.kind} claim`);
      claim.resolvedTick = state.tick + 48;
      if (won) { claim.status = "won"; claim.amountUsd = 0; events.push({ kind: "claim", tick: state.tick, text: `Contested the claim on ${cargo.id}: the inspector's re-test came back on spec. Claim withdrawn.`, data: { cargoId: cargo.id }, pause: true }); }
      else {
        claim.status = "lost"; claim.amountUsd = claim.amountUsd * 1.25;
        state.pnl.attribution.push(chargeCargo(state, cargo, "quality", claim.amountUsd, `${GRADES[cargo.grade].name} ${cargo.id}: contested claim lost; paid ${usd(claim.amountUsd)} including the re-test and the receiver's costs.`));
        events.push({ kind: "claim", tick: state.tick, text: `Contested the claim on ${cargo.id} and lost: ${usd(claim.amountUsd)} including costs.`, data: { cargoId: cargo.id }, pause: true });
      }
      break;
    }
    case "option_order": {
      const o = makeOptionOrder(state, a.player, a.inst, a.month, a.side, a.qty, a.kind, a.strike, a.tag ?? "option");
      events.push(...fillOption(state, o));
      break;
    }
    case "option_strategy": {
      const pk = `opt${state.counters.order + 1}`;
      for (const l of strategyLegs(a.name, a.strikes, a.side)) events.push(...fillOption(state, makeOptionOrder(state, a.player, a.inst, a.month, l.side, a.qty, l.kind, l.strike, a.tag ?? "option", pk)));
      events.push({ kind: "option", tick: state.tick, text: `${a.side === "buy" ? "Bought" : "Sold"} ${a.qty} ${a.name.replace("_", " ")}${a.qty > 1 ? "s" : ""} on ${INSTRUMENTS[a.inst].name} ${monthLabel(a.month)} at ${a.strikes.join("/")}: ${strategyLegs(a.name, a.strikes, a.side).map((l) => `${l.side} ${l.strike} ${l.kind}`).join(", ")}.`, data: { packageId: pk } });
      break;
    }
    case "set_runs": {
      const r = state.refinery!;
      r.runs = a.runs;
      const m = refineryMarginPerBbl(state, r.slate);
      events.push({ kind: "refinery", tick: state.tick, text: `Runs set to ${Math.round(a.runs * 100)}% of ${r.capacityKbd} kb/d: ${Math.round(r.capacityKbd * a.runs).toLocaleString()} kb/d of ${GRADES[r.slate].name} at ${m.perBbl.toFixed(2)} $/bbl of margin today (${usd(m.perBbl * r.capacityKbd * 1000 * a.runs)} a day before fixed costs).${r.shutUntil !== null && r.shutUntil > state.tick ? " The plant is shut: the setting applies when it restarts." : r.maintenanceUntil !== null && r.maintenanceUntil > state.tick ? " In turnaround: capped at 50% until it ends." : ""}` });
      break;
    }
    case "set_slate": {
      const r = state.refinery!;
      r.pendingSlate = a.grade;
      const m = refineryMarginPerBbl(state, a.grade);
      const now = refineryMarginPerBbl(state, r.slate);
      events.push({ kind: "refinery", tick: state.tick, text: `Slate change to ${GRADES[a.grade].name} from the next day's run: ${m.perBbl.toFixed(2)} $/bbl against ${now.perBbl.toFixed(2)} on ${GRADES[r.slate].name} at today's prices (${m.why})` });
      break;
    }
    case "book_regas": {
      const cargo = state.cargoes.find((c) => c.id === a.cargoId)!;
      cargo.regasBooked = true;
      events.push({ kind: "cargo", tick: state.tick, text: `Regasification slot booked at ${PORTS[cargo.dischargePort].name} for ${cargo.id}: the ship berths on arrival instead of waiting ${LNG_WAIT} days. The fee (${LNG_FEE.toFixed(2)} $/MMBtu) is paid at discharge either way.`, data: { cargoId: cargo.id } });
      break;
    }
    case "buy_feed": {
      fund(state, SIGNALS.feedCostUsd.value);
      ledger(state, "fee", -SIGNALS.feedCostUsd.value, "Assessment and signals feed for the level");
      state.pnl.attribution.push({ tick: state.tick, inst: "BRENT", month: "", leg: "finance", amount: -SIGNALS.feedCostUsd.value, text: `The assessment and signals feed: ${usd(SIGNALS.feedCostUsd.value)} for the level (stylised). Information costs money; it pays when it is acted on before the headline.` });
      state.feedBought = true;
      events.push({ kind: "signal", tick: state.tick, text: `Feed on: ${state.signals.length} signal series are live on Intel and the Map.`, pause: true });
      break;
    }
    case "request_limit": {
      if (a.limit === "netLots") for (const k of Object.keys(state.risk.limits.netLots) as InstrumentId[]) state.risk.limits.netLots[k] = a.value;
      else (state.risk.limits as unknown as Record<string, number>)[a.limit] = a.value;
      const text = `Limit ${a.limit} raised to ${Math.round(a.value).toLocaleString()} on your track record this level.`;
      state.risk.messages.push({ tick: state.tick, text, severity: "info" });
      events.push({ kind: "news", tick: state.tick, text });
      break;
    }
  }
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
const LNG_WAIT = 3;
const LNG_FEE = 0.5;

/** Execute an option order and book its consequences: fill, fees, lots, margin. */
export function fillOption(state: State, o: Order): EngineEvent[] {
  const { fill, refusal } = executeOption(state, o);
  if (!fill) return [{ kind: "news", tick: state.tick, text: `Option order refused: ${refusal}` }];
  const spec = INSTRUMENTS[fill.inst];
  ledger(state, "fee", -fill.fees, `Fees on ${fill.qty} ${spec.name} ${monthLabel(fill.month)} ${fill.option!.strike} ${fill.option!.kind}${fill.qty > 1 ? "s" : ""}`);
  state.pnl.fees += fill.fees;
  state.pnl.attribution.push(feeRow(state, fill));
  const { realised, rows } = applyFillToLots(state, fill);
  state.pnl.attribution.push(...rows);
  const notes = rebalanceMargin(state);
  const text = `${fill.side === "buy" ? "Bought" : "Sold"} ${fill.qty} ${spec.name} ${monthLabel(fill.month)} ${fill.option!.strike} ${fill.option!.kind}${fill.qty > 1 ? "s" : ""} at ${fill.price.toFixed(spec.decimals)} (${(fill.option!.iv * 100).toFixed(1)}% vol${fill.slippage > 0 ? `, ${fill.slippage.toFixed(spec.decimals)} slippage` : ""}); fees $${fill.fees.toFixed(0)}${realised !== 0 ? `; realised ${usd(realised)}` : ""}${notes.length ? `; ${notes.join("; ")}` : ""}. Futures-style: no premium paid now; the value settles daily.`;
  return [{ kind: "fill", tick: state.tick, text, data: { fillId: fill.id, inst: fill.inst, month: fill.month, side: fill.side, qty: fill.qty, price: fill.price, realised, option: fill.option } }];
}
void isListedStrike; void listedStrikes; void OPTIONS; void unitOf;

/** Draw the line for a payment the cash cannot cover; the draw is the desk's and repays itself when cash returns. */
function fund(state: State, amount: number): void {
  const short = amount - state.finance.cashUSD;
  if (short <= 0) return;
  const draw = Math.min(short, lineAvailable(state));
  if (draw <= 0) return;
  state.finance.lineDrawn += draw;
  state.finance.autoDrawn += draw;
  ledger(state, "line_draw", draw, `Drew $${Math.round(draw).toLocaleString()} on the line for a payment`);
}
