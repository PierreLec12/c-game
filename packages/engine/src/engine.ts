/**
 * newGame(), applyActions(), tick(), replay(). The engine takes a state and a list of actions and
 * returns the next state; it never reads a wall clock. One tick is one simulated hour.
 */
import { HOURS_PER_DAY, dayOfTick, expiryDay, formatClock, hourOfTick, isBusinessDay, isSettleTick, isTradingTick, listedMonths, monthLabel, nextSettleTick, parseDate, season, contractCode } from "./calendar";
import { CLOCK, INSTRUMENTS, VAR, type InstrumentId } from "./refdata";
import { makeRng, type Rng, type Stream } from "./rng";
import { ALL_INSTRUMENTS, anchors, initFactors, makeQuote, priceParts, stepFactorsDaily, stepFactorsHourly } from "./markets";
import { initWorld, stepWorldDaily } from "./world";
import { ckey, decayImpact, makeOrder, matchResting, resetDailyVolume } from "./liquidity";
import { accrueInterest, checkMarginCall, equity, initFinance, ledger, markEur, rebalanceMargin } from "./finance";
import { applyFillToLots, feeRow, settleLots, unrealised } from "./pnl";
import { bookVar, breaches, reductionScale, stressTable } from "./risk";
import { fireDue, scheduleEvents } from "./events";
import { addRelease, publishNews, releaseProximity } from "./information";
import { computeScore } from "./scoring";
import { applyAction, fillMarket, validateAction } from "./actions";
import { getLevel, type LevelSpec } from "./levels";
import { initFleet } from "./shipping";
import { cargoesMarkUsd, payDues, settlePhysical, physicalExposureBbl, physicalExposureAfterPrintsBbl } from "./physical";
import { netLots } from "./pnl";
import { stepVoyages } from "./voyages";
import { expireTenders, initCounterparties, moveRating } from "./counterparties";
import { chargeTanks, remarkTanks, tanksMarkUsd } from "./storage";
import { stepPipelineCargoes } from "./physical";
import { checkCovenant } from "./finance";
import { worstStress } from "./risk";
import { CHOKEPOINTS } from "./refdata";
import { COUNTERPARTIES } from "./world_data";
import { clone } from "./clone";
import { initRefinery, runRefineryDay } from "./refinery";
import { initSignals, stepSignals } from "./signals";
import { lotKey, makeOptionOrder } from "./optionbook";
import { fillOption } from "./actions";
import type { Action, Contract, EngineEvent, Factors, Fill, LogEntry, Refusal, State, TickResult, WorldState } from "./types";

export { makeRng };

function refsOf(spec: LevelSpec) {
  return { brentRef: spec.factors.brentRef ?? 75, hhRef: spec.factors.hhRef ?? 3, ttfRef: spec.factors.ttfRef ?? 35 };
}

/** Simulated pre-history of the factors so the VaR has closes to work with. Runs the same dynamics at negative ticks. */
function prehistory(spec: LevelSpec, rng: Rng, startDay: number): { world: WorldState; factors: Factors; history: State["history"] } {
  // the scenario's inventory picture is already in place during the pre-history; only the balance drift starts at day 0
  const base = spec.prehistoryWorld ?? spec.world;
  const neutral = initWorld({ ...base, crudeBalance: 0, targets: { ...(base.targets ?? {}), crudeBalance: 0 } });
  let world = neutral;
  let factors = initFactors(world, spec.factors, spec.regime);
  const refs = refsOf(spec);
  const history: State["history"] = [];
  const businessDaysWanted = VAR.historyDays.value;
  let day = startDay - 1;
  const days: number[] = [];
  while (days.length < businessDaysWanted) { days.unshift(day); day -= 1; }
  for (const d of days) {
    const tick0 = (d - startDay) * HOURS_PER_DAY;
    world = stepWorldDaily(world, rng.stream("world", tick0), spec.regime, season(d).winter);
    factors = stepFactorsDaily(factors, world, rng.stream("daily", tick0));
    if (!isBusinessDay(d)) continue;
    for (let h = 0; h < HOURS_PER_DAY; h++) {
      factors = stepFactorsHourly(factors, world, rng.stream("prices", tick0 + h), refs, { hour: h, day: d, regime: world.regime, releaseProximity: 0 }, rng.stream("gas", tick0 + h));
      if (h === CLOCK.settleHour.value) history.push({ factors, day: d });
    }
  }
  return { world, factors, history };
}

/** The solution bot's P&L on this seed: the par the score divides by. */
export function parFor(spec: LevelSpec, seed: number): number {
  if (spec.noPar) return 0;
  return runPolicy(spec, seed, spec.solve, 100000, { par: 0 }).state.pnl.total;
}

export function newGame(spec: LevelSpec, seed: number, opts: { par?: number } = {}): State {
  const par = opts.par ?? parFor(spec, seed);
  const rng = makeRng(seed);
  const startDay = parseDate(spec.startDate);
  const pre = prehistory(spec, rng, startDay);
  // the scenario starts here: the evolved pre-history world continues, with the level's balance, targets and regime; the curve sits at its anchors
  const designed = initWorld({ ...spec.world, regime: spec.regime });
  const carried = spec.prehistoryWorld ? { oecdInvGap: designed.oecdInvGap + (pre.world.oecdInvGap - (spec.prehistoryWorld.oecdInvGap ?? 0)), usInvGap: designed.usInvGap + (pre.world.usInvGap - (spec.prehistoryWorld.usInvGap ?? 0)) } : { oecdInvGap: pre.world.oecdInvGap, usInvGap: pre.world.usInvGap };
  const world: WorldState = { ...pre.world, ...carried, crudeBalance: designed.crudeBalance, targets: designed.targets, regime: designed.regime, baseRate: designed.baseRate, eventIntensity: 0, refineryRuns: designed.refineryRuns, geo: designed.geo };
  // the flat prices start at the pre-history equilibrium (its anchors), so a level opens where its own history says it should
  const preAnchor = anchors(pre.world, pre.factors, refsOf(spec), startDay);
  const snapped: Factors = { ...pre.factors, brentPrompt: Math.exp(preAnchor.logBrent), hhPrompt: Math.exp(preAnchor.logHh), ttfPrompt: Math.exp(preAnchor.logTtf) };
  const a = anchors(world, snapped, refsOf(spec), startDay);
  const factors: Factors = { ...snapped, bw: a.bw, gasolineCrack: a.gasolineCrack, dieselCrack: a.dieselCrack, fuelOilCrack: a.fuelOilCrack, dubaiEW: a.dubaiEW, spread1: { ...a.spread1, ...(spec.factors.spread1 ?? {}) } };
  const state: State = {
    version: 1, seed, tick: 0, startDay, world, factors, contracts: {}, listed: { BRENT: [], WTI: [], RBOB: [], ULSD: [], HH: [], TTF: [], DUBAI: [], JKM: [] }, quotes: {},
    lots: [], orders: [], fills: [],
    finance: initFinance(spec.capital, spec.creditLine),
    pnl: { realised: 0, unrealised: 0, fees: 0, interest: 0, today: 0, total: 0, attribution: [], equityCurve: [], settles: [] },
    risk: {
      var95: { v: 0, at: 0, why: "No open positions: VaR is zero." }, grossLots: 0, netLots: { BRENT: 0, WTI: 0, RBOB: 0, ULSD: 0, HH: 0, TTF: 0, DUBAI: 0, JKM: 0 },
      limits: { ...spec.limits, netLots: { ...spec.limits.netLots } }, breaches: [], lives: spec.lives, livesLost: 0, messages: [], stress: [],
      peakEquity: spec.capital, maxDrawdown: 0, closesInsideLimit: 0, closesTotal: 0, varBreachedAtClose: false, stopLossRef: 0, forcedReductions: 0, closes: [],
    },
    news: [], releases: [], events: [],
    cargoes: [], tenders: [], vessels: initFleet(), voyages: [], chokepoints: Object.fromEntries(CHOKEPOINTS.map((c) => [c.id, { id: c.id, status: "open" as const, since: 0, note: "open" }])), portCongestion: {},
    lcs: [], tanks: [], counterparties: initCounterparties(), infoDelayHours: spec.infoDelayHours ?? 0, pendingNewsDelay: 0,
    refinery: spec.refinery ? initRefinery(spec.refinery) : null, signals: [], feedBought: spec.feedIncluded === true, fx0: factors.eurusd, depthScale: spec.backMonthDepth ?? 1,
    level: {
      id: spec.id, tier: spec.tier, title: spec.title, startDay, endTick: spec.days * HOURS_PER_DAY, status: "running",
      objectives: spec.objectives.map((o) => ({ id: o.id, text: o.text, status: "pending" })), cardsUnlocked: [], cardsOpened: [],
      drills: spec.drills ? spec.drills(seed) : [], quiz: [], score: null, par, unlockedActions: [...spec.unlocks], instruments: [...spec.instruments], endedTick: null, mentorLines: [],
    },
    history: pre.history,
    counters: { lot: 0, order: 0, fill: 0, ledger: 0, news: 0, cargo: 0, tender: 0, voyage: 0, claim: 0, lc: 0, tank: 0, parcel: 0 },
    capital: spec.capital,
    paused: null,
  };
  ledger(state, "capital", spec.capital, `Capital for ${spec.title}: $${spec.capital.toLocaleString()}`);
  state.events = scheduleEvents(spec.events, rng.stream("schedule", 0));
  for (const ev of state.events) {
    if (ev.kind === "inventory_release") addRelease(state, { id: ev.id, name: "Weekly crude inventories", tick: ev.tick, unit: "mb" });
    if (ev.kind === "opec_meeting") addRelease(state, { id: ev.id, name: "OPEC+ meeting", tick: ev.tick, unit: "kb/d" });
    if (ev.kind === "positioning_report") addRelease(state, { id: ev.id, name: "Positioning report", tick: ev.tick, unit: "k lots" });
    if (ev.kind === "gas_storage_release") addRelease(state, { id: ev.id, name: "Weekly US gas storage", tick: ev.tick, unit: "bcf" });
  }
  state.signals = initSignals(state);
  refreshListings(state);
  rebuildQuotes(state, isTradingTick(startDay, 0));
  state.risk.var95 = bookVar(state);
  updateObjectives(state, spec);
  state.pnl.equityCurve.push({ tick: 0, equity: spec.capital, pnl: 0, ...{} });
  recordCurve(state);
  return state;
}

function refreshListings(state: State): void {
  const day = dayOfTick(state.startDay, state.tick);
  for (const inst of ALL_INSTRUMENTS) {
    const months = listedMonths(inst, day);
    state.listed[inst] = months;
    for (const m of months) {
      const key = ckey(inst, m);
      if (!state.contracts[key]) {
        const c: Contract = { inst, month: m, code: contractCode(inst, m), expiryTick: (expiryDay(inst, m) - state.startDay) * HOURS_PER_DAY + CLOCK.settleHour.value, settle: null, prevSettle: null, impact: 0, volumeToday: 0 };
        state.contracts[key] = c;
      }
    }
  }
  for (const key of Object.keys(state.contracts)) {
    const c = state.contracts[key];
    if (!state.listed[c.inst].includes(c.month)) { delete state.contracts[key]; delete state.quotes[key]; }
  }
}

function rebuildQuotes(state: State, open: boolean): void {
  const hour = hourOfTick(state.tick);
  for (const inst of ALL_INSTRUMENTS) {
    state.listed[inst].forEach((m, idx) => {
      const key = ckey(inst, m);
      const c = state.contracts[key];
      const tau = Math.max(0, (c.expiryTick - state.tick) / HOURS_PER_DAY / 30.4375);
      const mid = priceParts(state.factors, inst, tau).price + c.impact;
      state.quotes[key] = makeQuote(inst, m, mid, idx, hour, state.world.regime, open, state.tick, c.impact, state.depthScale);
    });
  }
}

function recordCurve(state: State): void {
  const u = unrealised(state) + cargoesMarkUsd(state) + tanksMarkUsd(state);
  const eq = equity(state, u);
  state.pnl.unrealised = u;
  state.pnl.total = eq - state.capital;
  if (eq > state.risk.peakEquity) state.risk.peakEquity = eq;
  state.risk.maxDrawdown = Math.max(state.risk.maxDrawdown, state.risk.peakEquity - eq);
  const front = state.quotes[ckey("BRENT", state.listed.BRENT[0])];
  const last = state.pnl.equityCurve[state.pnl.equityCurve.length - 1];
  const point = { tick: state.tick, equity: eq, pnl: eq - state.capital, price: front ? front.mid : 0 };
  if (last && last.tick === state.tick) state.pnl.equityCurve[state.pnl.equityCurve.length - 1] = point;
  else state.pnl.equityCurve.push(point);
  const lastSettle = state.pnl.settles[state.pnl.settles.length - 1];
  state.pnl.today = state.pnl.total - (lastSettle ? lastSettle.pnl : 0);
}

function updateObjectives(state: State, spec: LevelSpec): EngineEvent[] {
  const events: EngineEvent[] = [];
  spec.objectives.forEach((o, i) => {
    const prev = state.level.objectives[i].status;
    const next = o.check(state);
    if (next !== prev) {
      state.level.objectives[i].status = next;
      if (o.detail) state.level.objectives[i].detail = o.detail(state);
      events.push({ kind: "objective", tick: state.tick, text: `${next === "done" ? "Done" : next === "failed" ? "Failed" : "Reopened"}: ${o.text}`, data: { id: o.id, status: next } });
    }
  });
  return events;
}

/** Apply actions at the current tick without moving time. Refused actions change nothing. */
export function applyActions(state: State, actions: Action[], rng: Rng): TickResult {
  const spec = getLevel(state.level.id);
  const next = clone(state);
  const refused: Refusal[] = [];
  const events: EngineEvent[] = [];
  const s = rng.stream("actions", next.tick);
  for (const a of actions) {
    const reason = validateAction(next, spec, a);
    if (reason) { refused.push({ action: a, reason, tick: next.tick }); continue; }
    events.push(...applyAction(next, spec, a, s));
  }
  if (actions.length) {
    next.risk.var95 = bookVar(next);
    recordCurve(next);
    events.push(...updateObjectives(next, spec));
    events.push(...cardsAndMentor(next, spec, events));
    if (next.level.status === "running" && (next.tick >= next.level.endTick)) events.push(...endLevel(next, spec, "ended"));
    if (next.level.status !== "running") {
      next.level.score = computeScore(next, spec);
      if (next.level.quiz.every((q) => q.given !== undefined) && next.level.status === "ended") {
        next.level.status = next.level.score.passed ? "passed" : "failed";
        events.push({ kind: next.level.score.passed ? "level_passed" : "level_failed", tick: next.tick, text: next.level.score.passed ? `Level ${next.level.id} passed with ${next.level.score.total.toFixed(0)} points` : `Level ${next.level.id} not passed: ${next.level.score.total.toFixed(0)} points`, pause: true });
      }
    }
  }
  return { state: next, refused, events };
}

function cardsAndMentor(state: State, spec: LevelSpec, events: EngineEvent[]): EngineEvent[] {
  const out: EngineEvent[] = [];
  for (const c of spec.cards) {
    if (state.level.cardsUnlocked.includes(c.id)) continue;
    if (c.trigger(state, events)) {
      state.level.cardsUnlocked.push(c.id);
      out.push({ kind: "card", tick: state.tick, text: `New card: ${c.id}`, data: { cardId: c.id }, pause: true });
    }
  }
  if (spec.mentor) {
    for (const line of spec.mentor(state, [...events, ...out])) {
      state.level.mentorLines.push({ tick: state.tick, text: line });
      out.push({ kind: "mentor", tick: state.tick, text: line });
    }
  }
  return out;
}

/** Advance one simulated hour after applying the actions. */
export function tick(state: State, actions: Action[], rng: Rng): TickResult {
  const applied = applyActions(state, actions, rng);
  const next = applied.state;
  const events = [...applied.events];
  if (next.level.status !== "running") return { state: next, refused: applied.refused, events };
  const spec = getLevel(next.level.id);
  next.tick += 1;
  next.paused = null;
  const hour = hourOfTick(next.tick);
  const day = dayOfTick(next.startDay, next.tick);
  const refs = refsOf(spec);
  if (hour === 0) {
    const { winter } = season(day);
    next.world = stepWorldDaily(next.world, rng.stream("world", next.tick), spec.regime, winter);
    next.factors = stepFactorsDaily(next.factors, next.world, rng.stream("daily", next.tick));
    resetDailyVolume(next);
    refreshListings(next);
    events.push(...accrueDaily(next));
    // consensus for a release due today
    for (const r of next.releases) {
      if (!r.published && r.consensus === null && Math.floor(r.tick / HOURS_PER_DAY) === Math.floor(next.tick / HOURS_PER_DAY)) {
        if (r.name === "Weekly crude inventories") {
          const c = Math.round(((7 * 0.3 * next.world.targets.crudeBalance) / 1000 + rng.stream("consensus", next.tick).normal() * 1.2) * 10) / 10;
          r.consensus = { v: c, at: next.tick, why: "Analyst consensus for the weekly US crude stock change: the trend balance plus survey noise." };
        }
        if (r.name === "Weekly US gas storage") {
          const seasonal = next.world.targets.usGasGap >= 0 ? 60 : 40;
          const c = Math.round(seasonal - 6 * next.world.hddAnomaly.us + rng.stream("consensus", next.tick).normal() * 5);
          r.consensus = { v: c, at: next.tick, why: "Analyst consensus for the weekly storage change: the seasonal flow less the heating anomaly, plus survey noise." };
        }
      }
    }
  }
  const trading = isTradingTick(next.startDay, next.tick);
  if (trading) {
    next.factors = stepFactorsHourly(next.factors, next.world, rng.stream("prices", next.tick), refs, { hour, day, regime: next.world.regime, releaseProximity: releaseProximity(next) }, rng.stream("gas", next.tick));
    decayImpact(next);
  }
  const fired = fireDue(next, rng.stream("events", next.tick));
  events.push(...fired);
  events.push(...stepSignals(next, rng.stream("signals", next.tick)));
  for (const n of next.news) if (n.tick === next.tick && !events.some((e) => e.text === n.headline)) events.push({ kind: "news", tick: next.tick, text: n.shockTick !== undefined ? `${n.headline} (the market moved ${next.tick - n.shockTick} hours ago)` : n.headline, pause: n.shockTick !== undefined });
  rebuildQuotes(next, trading);
  if (trading) {
    const fills = matchResting(next);
    for (const f of fills) events.push(...bookFill(next, f));
  }
  {
    const v = stepVoyages(next);
    events.push(...v.events);
    next.pnl.attribution.push(...v.rows);
    const pl = stepPipelineCargoes(next);
    events.push(...pl.events);
    next.pnl.attribution.push(...pl.rows);
    if (hour === 0) next.pnl.attribution.push(...chargeTanks(next));
    for (const t of expireTenders(next)) {
      events.push({ kind: "tender", tick: next.tick, text: `Tender ${t.id} from ${COUNTERPARTIES[t.counterparty].name} expired${t.trap ? `. ${t.trap}` : "."}`, data: { tenderId: t.id } });
    }
    if (hour === 0) events.push(...payDues(next));
    if (hour === CLOCK.settleHour.value && next.refinery) { const r = runRefineryDay(next); next.pnl.attribution.push(...r.rows); events.push(...r.events); }
  }
  if (isSettleTick(next.startDay, next.tick)) events.push(...settle(next, spec));
  next.risk.var95 = bookVar(next);
  recordCurve(next);
  events.push(...updateObjectives(next, spec));
  events.push(...cardsAndMentor(next, spec, events));
  if (next.level.status === "running" && next.tick >= next.level.endTick) events.push(...endLevel(next, spec, "ended"));
  const pause = events.find((e) => e.pause);
  if (pause) next.paused = { reason: pause.text, tick: next.tick };
  return { state: next, refused: applied.refused, events };
}

function accrueDaily(state: State): EngineEvent[] {
  const i = accrueInterest(state);
  if (i > 0) {
    state.pnl.attribution.push({ tick: state.tick, inst: "BRENT", month: "", leg: "finance", amount: -i, text: `Interest on $${Math.round(state.finance.lineDrawn).toLocaleString()} drawn on the line for one day.` });
  }
  return [];
}

function bookFill(state: State, fill: Fill): EngineEvent[] {
  const spec = INSTRUMENTS[fill.inst];
  ledger(state, "fee", -fill.fees, `Fees on ${fill.qty} lots of ${spec.name} ${monthLabel(fill.month)}`);
  state.pnl.fees += fill.fees;
  state.pnl.attribution.push(feeRow(state, fill));
  const { realised, rows } = applyFillToLots(state, fill);
  state.pnl.attribution.push(...rows);
  rebalanceMargin(state);
  return [{ kind: "fill", tick: state.tick, text: `Resting order filled: ${fill.side === "buy" ? "bought" : "sold"} ${fill.qty} ${spec.name} ${monthLabel(fill.month)} at ${fill.price.toFixed(spec.decimals)}${realised !== 0 ? `; realised ${usd(realised)}` : ""}`, data: { fillId: fill.id, inst: fill.inst, month: fill.month, side: fill.side, qty: fill.qty, price: fill.price, realised }, pause: true }];
}

function usd(x: number): string { return (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString(); }

function settle(state: State, spec: LevelSpec): EngineEvent[] {
  const events: EngineEvent[] = [];
  const physBeforePrints = physicalExposureBbl(state).bbl;
  const settlePrices: Record<string, number> = {};
  for (const [key, q] of Object.entries(state.quotes)) {
    const c = state.contracts[key];
    c.prevSettle = c.settle ? c.settle.v : null;
    c.settle = { v: q.mid, at: state.tick, why: `Settlement at ${formatClock(state.startDay, state.tick)}: the model mid at the close.` };
    settlePrices[key] = q.mid;
  }
  markEur(state);
  const { rows, vmUsd, vmEur } = settleLots(state, settlePrices);
  state.pnl.attribution.push(...rows);
  if (Math.abs(vmUsd) > 0.005) { ledger(state, "variation_margin", vmUsd, `Variation margin at the ${formatClock(state.startDay, state.tick)} settle`); state.pnl.realised += vmUsd; }
  if (Math.abs(vmEur) > 0.005) { ledger(state, "variation_margin", vmEur, `Variation margin (EUR) at the settle`, "EUR"); state.pnl.realised += vmEur * state.factors.eurusd; }
  // option expiries: an option lot on its last day has just been marked at intrinsic value; it leaves the book
  {
    const expired = state.lots.filter((l) => l.option && l.option.expiryTick <= state.tick);
    if (expired.length) {
      state.lots = state.lots.filter((l) => !expired.includes(l));
      const groups = new Map<string, number>();
      for (const l of expired) groups.set(`${INSTRUMENTS[l.inst].name} ${monthLabel(l.month)} ${l.option!.strike} ${l.option!.kind}`, (groups.get(`${INSTRUMENTS[l.inst].name} ${monthLabel(l.month)} ${l.option!.strike} ${l.option!.kind}`) ?? 0) + l.qty);
      for (const [name, qty] of groups) events.push({ kind: "expiry", tick: state.tick, text: `${name} expired: ${Math.abs(qty)} lots ${qty > 0 ? "long" : "short"} cash-settled at intrinsic value (${expired.find((l) => `${INSTRUMENTS[l.inst].name} ${monthLabel(l.month)} ${l.option!.strike} ${l.option!.kind}` === name)!.lastMark.toFixed(INSTRUMENTS[expired[0].inst].decimals)}). An option hedge that needed to live longer should have been rolled.`, pause: true, data: { option: name, qty } });
    }
  }
  // expiries: lots in a contract on its last day are cash-settled at the settle
  for (const c of Object.values(state.contracts)) {
    if (c.expiryTick !== state.tick) continue;
    const lots = state.lots.filter((l) => l.inst === c.inst && l.month === c.month && !l.option);
    if (lots.length) {
      const net = lots.reduce((a, l) => a + l.qty, 0);
      const o = makeOrder(state, "exchange", c.inst, c.month, net > 0 ? "sell" : "buy", Math.abs(net), "market", undefined, "expiry");
      const q = state.quotes[ckey(c.inst, c.month)];
      // cash settlement at the settle price: no spread crossed
      state.quotes[ckey(c.inst, c.month)] = { ...q, bid: q.mid, ask: q.mid, depth: 1e9 };
      const fe = fillMarket(state, o);
      state.quotes[ckey(c.inst, c.month)] = q;
      events.push({ kind: "expiry", tick: state.tick, text: `${INSTRUMENTS[c.inst].name} ${monthLabel(c.month)} expired: ${Math.abs(net)} lots cash-settled at ${q.mid.toFixed(INSTRUMENTS[c.inst].decimals)}. A hedge that needed to live longer should have been rolled.`, pause: true, data: { inst: c.inst, month: c.month, net } });
      void fe;
    }
    publishNews(state, { source: "exchange", headline: `${INSTRUMENTS[c.inst].name} ${monthLabel(c.month)} expired at ${c.settle!.v.toFixed(INSTRUMENTS[c.inst].decimals)}`, body: "Last trading day. The next month is now the front." });
  }
  {
    const ph = settlePhysical(state);
    state.pnl.attribution.push(...ph.rows);
    events.push(...ph.events);
    state.pnl.attribution.push(...remarkTanks(state));
  }
  state.history.push({ factors: state.factors, day: dayOfTick(state.startDay, state.tick) });
  rebalanceMargin(state);
  // the margin call raised at the last close must be met by this one
  const call = state.finance.marginCall;
  if (call && call.dueTick <= state.tick && state.finance.cashUSD < -0.005) {
    events.push(...liquidate(state, `Margin call of ${usd(call.amount)} not met by the close: the clearer liquidated the book at the touch.`));
    state.finance.marginCall = null;
  }
  const mc = checkMarginCall(state, nextSettleTick(state.startDay, state.tick));
  if (mc.raised) {
    const text = `Margin call: cash is ${usd(-mc.amount)} after variation margin and the line is ${state.finance.lineCut ? "cut" : "fully drawn"}. Fund ${usd(mc.amount)} or reduce the book by the next close, or the clearer liquidates at the touch.`;
    state.risk.messages.push({ tick: state.tick, text, severity: "breach" });
    events.push({ kind: "margin_call", tick: state.tick, text, pause: true, data: { amount: mc.amount } });
  } else if (mc.met) events.push({ kind: "margin_met", tick: state.tick, text: "Margin call met." });
  state.pnl.settles.push({ tick: state.tick, pnl: equity(state, cargoesMarkUsd(state) + tanksMarkUsd(state)) - state.capital });
  events.push(...riskAtClose(state, spec, physBeforePrints));
  events.push(...checkCovenant(state));
  events.push({ kind: "session_close", tick: state.tick, text: `Session close ${formatClock(state.startDay, state.tick)}: P&L today ${usd(state.pnl.today)}, level ${usd(equity(state, 0) - state.capital)}`, pause: true });
  return events;
}

function riskAtClose(state: State, spec: LevelSpec, physBeforePrints?: number): EngineEvent[] {
  const events: EngineEvent[] = [];
  state.risk.var95 = bookVar(state);
  state.risk.stress = stressTable(state);
  recordCurve(state);
  state.risk.closesTotal += 1;
  // the physical exposure a trader could have hedged by this close: the day's prints land at the settle itself
  state.risk.closes.push({ tick: state.tick, physBbl: physBeforePrints ?? physicalExposureBbl(state).bbl, net: netLots(state), var95: state.risk.var95?.v ?? 0, pnl: state.pnl.total, cashUsd: state.finance.cashUSD });
  const v = state.risk.var95;
  if (!v || v.v <= state.risk.limits.var95) state.risk.closesInsideLimit += 1;
  else state.risk.varBreachedAtClose = true;
  const levelPnl = state.pnl.total - state.risk.stopLossRef;
  const list = breaches(state, levelPnl);
  const fatal = list.filter((b) => b.limit === "stop_loss" || b.limit === "drawdown");
  const soft = list.filter((b) => b.limit !== "stop_loss" && b.limit !== "drawdown");
  const seen = new Set<string>();
  let strike = 0;
  for (const b of soft) {
    seen.add(b.limit);
    const rec = state.risk.breaches.find((x) => x.limit === b.limit);
    const consecutive = rec ? rec.consecutive + 1 : 1;
    if (rec) { rec.consecutive = consecutive; rec.lastTick = state.tick; } else state.risk.breaches.push({ limit: b.limit, consecutive, lastTick: state.tick });
    strike = Math.max(strike, consecutive);
  }
  for (const rec of state.risk.breaches) if (!seen.has(rec.limit)) rec.consecutive = 0;
  if (soft.length) {
    const what = soft.map((b) => b.text).join("; ");
    const formulas = soft.map((b) => limitFormula(b.limit)).join(". ");
    // a concentration breach cannot be cut at the touch: it is a warning every close and a life after five
    const onlyConcentration = soft.every((b) => b.limit === "concentration");
    if (onlyConcentration && strike < 5) {
      const text = `${riskManager(spec)}: ${what}. ${strike === 1 ? "No more exposure to that name; reduce it as the invoices clear." : `Close ${strike} in breach; at five that is a life.`} (${formulas})`;
      state.risk.messages.push({ tick: state.tick, text, severity: "warning" });
      events.push({ kind: "limit_warning", tick: state.tick, text, pause: strike === 1, data: { limits: soft.map((b) => b.limit) } });
    } else if (onlyConcentration) {
      events.push(...loseLife(state, spec, `${riskManager(spec)}: ${what} for five closes. That is a life.`));
    } else if (strike === 1) {
      const text = `${riskManager(spec)}: ${what}. Reduce by the next close or I reduce it for you. (${formulas}) ${worstStress(state)}`;
      state.risk.messages.push({ tick: state.tick, text, severity: "warning" });
      events.push({ kind: "limit_warning", tick: state.tick, text, pause: true, data: { limits: soft.map((b) => b.limit) } });
    } else if (strike === 2) {
      const scale = reductionScale(state);
      events.push(...forcedReduce(state, scale, `${riskManager(spec)}: ${what} for a second close. Cutting the book to ${Math.round(scale * 100)}% at the touch.`));
    } else {
      events.push(...loseLife(state, spec, `${riskManager(spec)}: ${what} for a third close. That is a life.`));
    }
  }
  for (const b of fatal) {
    events.push(...loseLife(state, spec, `${riskManager(spec)}: ${b.text}. Book flattened. That is a life.`));
    if (b.limit === "stop_loss") state.risk.stopLossRef = state.pnl.total;
    if (b.limit === "drawdown") { state.risk.peakEquity = equity(state, cargoesMarkUsd(state) + tanksMarkUsd(state)); state.risk.maxDrawdown = 0; }
  }
  return events;
}

function riskManager(spec: LevelSpec): string { void spec; return "Risk (T. Lindqvist)"; }
function limitFormula(limit: string): string {
  switch (limit) {
    case "var95": return "VaR: the 95th percentile of simulated one-day losses on the current book over the last 250 sessions";
    case "netLots": return "net lots: long minus short per instrument";
    case "grossLots": return "gross lots: all open lots, long plus short";
    case "concentration": return "concentration: what you are owed by one counterparty plus what you have bought from it and not received, as a multiple of capital";
    default: return limit;
  }
}

function forcedReduce(state: State, scale: number, text: string): EngineEvent[] {
  const events: EngineEvent[] = [{ kind: "forced_reduction", tick: state.tick, text, pause: true }];
  state.risk.messages.push({ tick: state.tick, text, severity: "breach" });
  state.risk.forcedReductions += 1;
  const byContract = new Map<string, number>();
  for (const l of state.lots) byContract.set(lotKey(l), (byContract.get(lotKey(l)) ?? 0) + l.qty);
  for (const [key, net] of byContract) {
    const cut = Math.ceil(Math.abs(net) * (1 - scale));
    if (cut <= 0) continue;
    events.push(...closeSome(state, "risk", key, net, cut, "forced"));
  }
  return events;
}

function liquidate(state: State, text: string): EngineEvent[] {
  const events: EngineEvent[] = [{ kind: "liquidation", tick: state.tick, text, pause: true }];
  state.risk.messages.push({ tick: state.tick, text, severity: "breach" });
  const byContract = new Map<string, number>();
  for (const l of state.lots) byContract.set(lotKey(l), (byContract.get(lotKey(l)) ?? 0) + l.qty);
  for (const [key, net] of byContract) {
    if (net === 0) continue;
    events.push(...closeSome(state, "clearer", key, net, Math.abs(net), "forced"));
  }
  for (const o of state.orders) if (o.status === "resting") o.status = "cancelled";
  return events;
}

/** Close `cut` lots of a futures or option position by its key, at the touch. */
function closeSome(state: State, who: string, key: string, net: number, cut: number, tag: "forced"): EngineEvent[] {
  const parts = key.split(":");
  const inst = parts[0] as InstrumentId;
  const month = parts[1];
  const side: "buy" | "sell" = net > 0 ? "sell" : "buy";
  if (parts.length === 4) return fillOption(state, makeOptionOrder(state, who, inst, month, side, cut, parts[2] as "call" | "put", Number(parts[3]), tag));
  return fillMarket(state, makeOrder(state, who, inst, month, side, cut, "market", undefined, tag));
}

function loseLife(state: State, spec: LevelSpec, text: string): EngineEvent[] {
  state.risk.lives -= 1;
  state.risk.livesLost += 1;
  state.risk.messages.push({ tick: state.tick, text, severity: "life" });
  const events: EngineEvent[] = [{ kind: "life_lost", tick: state.tick, text, pause: true, data: { lives: state.risk.lives } }];
  events.push(...liquidate(state, "Book flattened by the risk manager."));
  for (const rec of state.risk.breaches) rec.consecutive = 0;
  if (state.risk.lives <= 0) events.push(...endLevel(state, spec, "failed"));
  return events;
}

function endLevel(state: State, spec: LevelSpec, status: "ended" | "failed"): EngineEvent[] {
  state.level.status = status;
  state.level.endedTick = state.tick;
  state.level.quiz = spec.quiz(state);
  state.level.score = computeScore(state, spec);
  const events: EngineEvent[] = [{ kind: "level_ended", tick: state.tick, text: status === "failed" ? `Level ${spec.id} failed: no lives left. Read the debrief and replay it.` : `Level ${spec.id} ended: open the debrief.`, pause: true }];
  if (state.level.quiz.length === 0) {
    state.level.status = state.level.score.passed ? "passed" : "failed";
    events.push({ kind: state.level.score.passed ? "level_passed" : "level_failed", tick: state.tick, text: state.level.score.passed ? `Level ${spec.id} passed with ${state.level.score.total.toFixed(0)} points` : `Level ${spec.id} not passed: ${state.level.score.total.toFixed(0)} points`, pause: true });
  }
  return events;
}

/** Rebuild the state at the end of a log from the seed: the proof that the world is deterministic. */
export function replay(seed: number, levelId: number, log: LogEntry[], untilTick?: number, opts: { par?: number } = {}): State {
  const spec = getLevel(levelId);
  const rng = makeRng(seed);
  let state = newGame(spec, seed, opts);
  const sorted = [...log].sort((a, b) => a.tick - b.tick);
  for (const entry of sorted) {
    while (state.tick < entry.tick && state.level.status === "running") state = tick(state, [], rng).state;
    if (state.level.status === "running") state = tick(state, entry.actions, rng).state;
    else state = applyActions(state, entry.actions, rng).state;
  }
  const target = untilTick ?? state.tick;
  while (state.tick < target && state.level.status === "running") state = tick(state, [], rng).state;
  return state;
}

/** What-if replays (section 10): the same seed and log with every hedge removed, or with the unpriced barrels hedged one-for-one at every close. */
export function whatIf(seed: number, levelId: number, log: LogEntry[], mode: "unhedged" | "fullhedge", untilTick?: number, opts: { par?: number } = {}): State {
  const isHedge = (a: Action) => (a.type === "order" && a.tag === "hedge") || a.type === "efp";
  const stripped = log.map((e) => ({ tick: e.tick, actions: e.actions.filter((a) => !isHedge(a)) })).filter((e) => e.actions.length);
  if (mode === "unhedged") return replay(seed, levelId, stripped, untilTick, opts);
  const spec = getLevel(levelId);
  const rng = makeRng(seed);
  let state = newGame(spec, seed, opts);
  const sorted = [...stripped].sort((a, b) => a.tick - b.tick);
  const overlay = (s: State): Action[] => {
    if (!s.level.instruments.includes("BRENT") || !s.level.unlockedActions.includes("order")) return [];
    const q = s.quotes[ckey("BRENT", s.listed.BRENT[0])];
    if (!q || !q.open) return [];
    const phys = physicalExposureAfterPrintsBbl(s);
    const held = s.lots.filter((l) => l.inst === "BRENT").reduce((a, l) => a + l.qty, 0) * 1000;
    const lots = Math.round((-phys - held) / 1000);
    if (Math.abs(lots) < 5) return [];
    const month = s.listed.BRENT[Math.min(1, s.listed.BRENT.length - 1)];
    return [{ type: "order", player: "p1", inst: "BRENT", month, side: lots > 0 ? "buy" : "sell", qty: Math.min(250, Math.abs(lots)), kind: "market", tag: "hedge" }];
  };
  let i = 0;
  const target = untilTick ?? (sorted.length ? sorted[sorted.length - 1].tick : 0);
  while (state.level.status === "running" && state.tick < target) {
    const acts: Action[] = [];
    while (i < sorted.length && sorted[i].tick === state.tick) { acts.push(...sorted[i].actions); i += 1; }
    acts.push(...overlay(state));
    state = tick(state, acts, rng).state;
  }
  while (i < sorted.length && state.level.status !== "running") { state = applyActions(state, sorted[i].actions, rng).state; i += 1; }
  return state;
}

/** Run a level with a policy until it ends. Used by the solution-bot tests and the ghost line. */
export function runPolicy(spec: LevelSpec, seed: number, policy: (state: State) => Action[], maxTicks = 100000, opts: { par?: number } = {}): { state: State; log: LogEntry[]; events: EngineEvent[] } {
  const rng = makeRng(seed);
  let state = newGame(spec, seed, opts);
  const log: LogEntry[] = [];
  const allEvents: EngineEvent[] = [];
  let guard = 0;
  while (state.level.status === "running" && guard < maxTicks) {
    const actions = policy(state);
    if (actions.length) log.push({ tick: state.tick, actions });
    const r = tick(state, actions, rng);
    state = r.state;
    allEvents.push(...r.events);
    guard += 1;
  }
  // the debrief quiz
  let quizGuard = 0;
  while (state.level.status === "ended" && quizGuard < 20) {
    const actions = policy(state);
    if (!actions.length) break;
    log.push({ tick: state.tick, actions });
    const r = applyActions(state, actions, rng);
    state = r.state;
    allEvents.push(...r.events);
    quizGuard += 1;
  }
  return { state, log, events: allEvents };
}

export { getLevel };
export const describeTick = (state: State) => formatClock(state.startDay, state.tick);
export const isTradingNow = (state: State) => isTradingTick(state.startDay, state.tick);
