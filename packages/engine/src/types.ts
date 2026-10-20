/**
 * The engine's contract (section 3.2): a plain serialisable State, typed Actions, Refusals, EngineEvents.
 * Nothing here knows about the screen.
 */
import type { InstrumentId } from "./refdata";
import type { Basis, Grade, VesselClass } from "./world_data";

export type PlayerId = string;
export type Regime = "calm" | "normal" | "stressed" | "crisis";
export type MonthKey = string; // "YYYY-MM"

/** An explained number: the value, the tick it was produced at, and what it was derived from (non-negotiable 3). */
export interface Fig {
  v: number;
  at: number;
  why: string;
}

export interface WorldState {
  crudeBalance: number; // kb/d, positive = surplus (stock build)
  oecdInvGap: number; // mb versus seasonal normal
  usInvGap: number; // mb versus seasonal normal (Cushing and USGC)
  productInvGap: { gasoline: number; distillate: number; fuelOil: number }; // mb versus normal
  refineryRuns: number; // share of capacity
  geo: number; // geopolitics risk index 0..1
  freightDemand: number; // tonne-mile demand versus fleet, 1 = balanced
  gasStorageGap: { us: number; eu: number }; // bcf and TWh versus five-year normal
  hddAnomaly: { us: number; eu: number }; // heating degree days versus normal
  lngArrivals: number; // index, 1 = normal
  regime: Regime;
  eventIntensity: number; // decays; raises vol and tightens liquidity
  baseRate: number; // annual, decimal
  /** scenario targets the latent state mean-reverts to (set by the level and moved by events) */
  targets: { crudeBalance: number; geo: number; refineryRuns: number; usGasGap: number; euGasGap: number; hddUs: number; hddEu: number; freightDemand: number };
}

export interface Factors {
  brentPrompt: number; // $/bbl, the latent flat price at tau = 0
  bw: number; // Brent minus WTI, $/bbl
  gasolineCrack: number; // $/bbl over WTI
  dieselCrack: number;
  fuelOilCrack: number;
  hhPrompt: number; // $/MMBtu
  ttfPrompt: number; // EUR/MWh
  eurusd: number;
  dubaiEW: number; // Brent minus Dubai
  datedDiff: number; // Dated Brent minus the front future, published daily
  jkmPremium: number; // JKM over TTF in $/MMBtu: the Asian premium
  spread1: Record<InstrumentId, number>; // front monthly spread, price units per month (positive = contango)
  vol: Record<InstrumentId, number>; // annualised implied vol at the front
  gradeDiffs: Record<Grade, number>; // market differential of each grade versus its benchmark, $/bbl
  freightIndex: number; // 1 = base hire; rises with tonne-mile demand and chokepoint shocks
}

export interface Contract {
  inst: InstrumentId;
  month: MonthKey;
  code: string;
  expiryTick: number; // last tick at which the contract trades (its last settle)
  settle: Fig | null; // last settlement price
  prevSettle: number | null;
  impact: number; // residual impact of the player's own orders on the mid, price units
  volumeToday: number; // lots traded by the player today (block rule)
}

export interface Quote {
  inst: InstrumentId;
  month: MonthKey;
  mid: number;
  bid: number;
  ask: number;
  depth: number; // lots at the touch each side
  spreadTicks: number;
  at: number;
  open: boolean; // false when the market is closed (weekend, holiday)
  why: string;
}

export type LegTag = "outright" | "time_spread" | "inter_commodity" | "crack" | "roll" | "hedge" | "forced" | "expiry" | "signal" | "option";

export interface Lot {
  id: string;
  inst: InstrumentId;
  month: MonthKey;
  qty: number; // lots, positive = long
  entry: number; // fill price
  openedTick: number;
  tag: LegTag;
  packageId?: string;
  /** factor decomposition of the contract price at the last settle (or at entry): the base for the next attribution */
  base: Record<string, number>;
  baseFx: number; // EURUSD at the base (TTF only)
  lastMark: number; // contract price at the last settle (or entry)
  /** an option on the futures month: kind, strike, its own expiry, and the inputs at the last mark for the Greek attribution */
  option?: { kind: "call" | "put"; strike: number; expiryTick: number; base: { F: number; sigma: number; T: number } };
}

export interface Order {
  id: string;
  player: PlayerId;
  inst: InstrumentId;
  month: MonthKey;
  side: "buy" | "sell";
  qty: number;
  kind: "market" | "limit" | "stop";
  price?: number; // limit or stop price
  tag: LegTag;
  packageId?: string;
  option?: { kind: "call" | "put"; strike: number };
  placedTick: number;
  status: "resting" | "filled" | "cancelled" | "refused";
}

export interface Fill {
  id: string;
  tick: number;
  orderId: string;
  inst: InstrumentId;
  month: MonthKey;
  side: "buy" | "sell";
  qty: number;
  price: number;
  mid: number; // the mid before the order touched it
  slippage: number; // price units, positive = paid
  fees: number; // USD
  tag: LegTag;
  packageId?: string;
  option?: { kind: "call" | "put"; strike: number; iv: number };
}

export type LedgerKind = "capital" | "variation_margin" | "initial_margin" | "margin_release" | "fee" | "line_draw" | "line_repay" | "interest" | "fx" | "liquidation" | "drill" | "other";
export interface LedgerRow {
  id: string;
  tick: number;
  kind: LedgerKind;
  amount: number; // USD, signed, to the cash account
  currency: "USD" | "EUR";
  text: string;
}

export interface FinanceState {
  cashUSD: number;
  cashEUR: number;
  marginAccount: number; // USD held at the clearer as initial margin
  marginRequired: number; // USD initial margin required for the open book
  marginCall: { amount: number; dueTick: number; raisedTick: number } | null;
  marginCalls: number; // count this level
  lineDrawn: number;
  lineLimit: number;
  lineCut: boolean;
  autoDrawn: number; // the part of the line the engine drew for margin; repaid as soon as cash allows
  eurFxMark: number; // EURUSD at which the EUR cash balance was last revalued
  ledger: LedgerRow[];
  interestAccrued: number;
}

export interface AttributionRow {
  tick: number;
  inst: InstrumentId;
  month: MonthKey;
  leg: AttributionLeg;
  amount: number; // USD
  text: string;
  lotId?: string;
  packageId?: string;
  greek?: Greek; // an options row: which Greek this part of the move was
}
export type AttributionLeg = "flat" | "basis" | "time_spread" | "crack" | "fees_slippage" | "fx" | "finance" | "options" | "freight" | "demurrage" | "storage" | "quality" | "credit" | "refinery";
export type Greek = "delta" | "gamma" | "vega" | "theta" | "other";

export interface RiskLimits {
  var95: number; // USD
  netLots: Record<InstrumentId, number>; // per instrument absolute net lots
  grossLots: number; // across the book
  stopLoss: number; // USD, level P&L below -stopLoss loses a life
  drawdown: number; // USD, from the peak
  concentration: number; // the most one counterparty may be exposed for, as a multiple of capital (50 or more: no limit)
  nakedShortOptions?: number; // lots of short options not covered by the underlying (absent: no limit)
}

export interface RiskState {
  var95: Fig | null;
  grossLots: number;
  netLots: Record<InstrumentId, number>;
  limits: RiskLimits;
  breaches: { limit: string; consecutive: number; lastTick: number }[];
  lives: number;
  livesLost: number;
  messages: { tick: number; text: string; severity: "info" | "warning" | "breach" | "life" }[];
  stress: { priceShock: number; volShock: number; pnlChange: number }[];
  peakEquity: number;
  maxDrawdown: number;
  closesInsideLimit: number;
  closesTotal: number;
  varBreachedAtClose: boolean;
  stopLossRef: number; // level P&L at the last life lost; the stop-loss measures from here
  forcedReductions: number;
  closes: { tick: number; physBbl: number; net: Record<InstrumentId, number>; var95: number; pnl: number; cashUsd: number }[]; // one row per settle: what the book looked like at the close
}

export interface NewsItem {
  id: string;
  tick: number;
  headline: string;
  body: string;
  source: "wire" | "release" | "leak" | "rumour" | "mentor" | "risk" | "exchange";
  reliability: number; // the base rate for this source type, shown after resolution
  eventId?: string;
  resolved?: { tick: number; outcome: "true" | "false"; text: string };
  shockTick?: number; // when the thing it reports actually happened (delayed news)
}

export interface Release {
  id: string;
  name: string;
  tick: number;
  consensus: Fig | null;
  actual: Fig | null;
  unit: string;
  published: boolean;
}

export interface ScheduledEvent {
  id: string;
  kind: string;
  tick: number;
  fired: boolean;
  params: Record<string, number | string | boolean>;
}

export interface ObjectiveStatus {
  id: string;
  text: string;
  status: "pending" | "done" | "failed";
  detail?: string;
}

export interface DrillQuestion {
  id: string;
  type: string;
  prompt: string;
  answer: number;
  unit: string;
  decimals: number;
  tolerance: number;
  working: string;
  given?: number;
  correct?: boolean;
}

export interface QuizQuestion {
  id: string;
  text: string;
  choices: string[];
  correct: number;
  explanation: string;
  given?: number;
}

export interface LevelState {
  id: number;
  tier: number;
  title: string;
  startDay: number;
  endTick: number;
  status: "running" | "passed" | "failed" | "ended";
  objectives: ObjectiveStatus[];
  cardsUnlocked: string[];
  cardsOpened: string[];
  drills: DrillQuestion[];
  quiz: QuizQuestion[];
  score: ScoreCard | null;
  par: number; // the solution bot's P&L on this seed
  unlockedActions: ActionType[];
  instruments: InstrumentId[];
  endedTick: number | null;
  mentorLines: { tick: number; text: string }[];
}

export interface ScoreCard {
  pnl: number;
  par: number;
  pnlComponent: number;
  process: number;
  processComponent: number;
  maxDrawdown: number;
  drawdownComponent: number;
  quiz: number;
  quizComponent: number;
  total: number;
  passed: boolean;
  formula: string;
  achievements: string[];
}

export interface PnlState {
  realised: number;
  unrealised: number;
  fees: number;
  interest: number;
  today: number;
  total: number; // level P&L, USD
  attribution: AttributionRow[];
  equityCurve: { tick: number; equity: number; pnl: number }[];
  settles: { tick: number; pnl: number }[];
}


// ---------------------------------------------------------------- physical: cargoes, tenders, ships
export type Incoterm = "FOB" | "CIF" | "DES";
/** A pricing window: which days' assessments average into the price. Day numbers are level days. */
export interface WindowSpec { kind: "after_bl" | "after_discharge" | "month_avg_bl" | "deemed" | "month_avg_offset"; days?: number; deemedDay?: number; offsetMonths?: number }
export interface CargoLeg {
  counterparty: string;
  basis: Basis;
  window: WindowSpec;
  diff: number; // contracted differential, $/bbl over the basis
  incoterm: Incoterm;
  port: string;
  windowDays: number[] | null; // level days of the window once the anchor (B/L or discharge) is known
  prints: Record<number, number>; // day -> the basis assessment that printed
  fixed: number | null; // final price per bbl (basis average plus diff) once every day has printed
  base: Record<string, number>; // USD by factor part over the unpriced days at the last mark
  unpricedDays: number[]; // the days still unpriced at the last mark (empty when fully priced or not yet anchored)
  marked: boolean; // false until the leg has been booked once (its first mark books the whole leg)
  expectedAnchorDay: number; // the day the window is expected to anchor on, for marking before it is known
  amountUsd: number | null; // the invoice once fixed
  dueTick: number | null;
  paidTick: number | null;
}
export interface Claim { id: string; tick: number; kind: "quality" | "demurrage"; from: string; amountUsd: number; text: string; status: "open" | "settled" | "contested" | "won" | "lost"; resolvedTick?: number }
export type CargoStatus = "contracted" | "fixed" | "loading" | "laden" | "discharging" | "delivered" | "cancelled";
export interface Cargo {
  id: string;
  tenderId: string;
  grade: Grade;
  bbl: number;
  purchase: CargoLeg;
  sale: CargoLeg | null;
  status: CargoStatus;
  loadPort: string;
  dischargePort: string;
  laycan: [number, number]; // level days
  dischargeWindow: [number, number] | null; // level days the receiver's berth is held for
  vesselId: string | null;
  voyageId: string | null;
  blTick: number | null;
  dischargeTick: number | null;
  quality: { api: number; sulphur: number };
  claims: Claim[];
  freight: { expectedUsd: number; fixedUsd: number | null; paidTick: number | null; base: number }; // base: the freight marked at the last settle (USD, positive cost)
  demurrageUsd: number;
  demurragePaidTick: number | null;
  warRiskUsd: number;
  extraCostsBase: number; // demurrage + war risk + claims marked at the last settle
  marketBase: Record<string, number>; // for an unsold cargo: the expected sale value by part at the last mark
  createdTick: number;
  requiresLc: boolean; // the seller wants a letter of credit before loading
  lcId: string | null;
  prepaidUsd: number; // paid to the seller before pricing, for a discount on the differential
  insured: boolean; // non-performance insurance on this cargo's counterparties
  tankId: string | null; // in storage: the tank the oil sits in
  parcelId: string | null;
  cancelled: { tick: number; by: string; reason: string } | null;
  regasBooked: boolean; // LNG: a regasification slot at the discharge terminal
  boilOffUsd: number; // LNG: cargo lost to boil-off on the voyage, booked at discharge
}
export interface Tender {
  id: string;
  counterparty: string;
  side: "offer" | "bid"; // offer: they sell a cargo to you; bid: they buy a cargo from you
  grade: Grade;
  bbl: number;
  incoterm: Incoterm;
  port: string; // load port for an offer, discharge port for a bid
  basis: Basis;
  window: WindowSpec;
  diff: number;
  laycan: [number, number]; // level days (an offer); for a bid, the discharge window
  openedTick: number;
  expiresTick: number;
  status: "open" | "accepted" | "expired" | "declined";
  note: string; // what the counterparty says
  trap: string | null; // what the mentor says afterwards if there was one (hidden until the tender closes)
  fairDiff: number; // the market differential at issue, for the debrief
  requiresLc: boolean;
  prepayDiscount: number; // $/bbl off the differential if the buyer prepays (0 = not offered)
  countered: { diff: number; answer: "accepted" | "declined"; tick: number } | null; // the player's counter and the reply
  declineReason: string | null;
}
export interface Vessel { id: string; name: string; cls: VesselClass; owner: string; status: "available" | "ballast" | "loading" | "laden" | "discharging" | "waiting"; lon: number; lat: number; node: string; atPort: string | null; voyageId: string | null; age: number; speedFactor: number }
export interface VoyageLeg { kind: "ballast" | "laden"; from: string; to: string; path: string[]; nm: number; depTick: number | null; arrTick: number | null }
export type VoyageStatus = "ballast" | "waiting_laycan" | "loading" | "laden" | "waiting_chokepoint" | "waiting_berth" | "anchored" | "discharging" | "done";
export interface Voyage {
  id: string;
  vesselId: string;
  cargoId: string;
  legs: VoyageLeg[];
  legIndex: number;
  nmDone: number; // along the current leg
  speedFactor: number; // 1 = service speed; slow steaming below
  status: VoyageStatus;
  hireUsdPerDay: number;
  lumpUsd: number; // the voyage charter as fixed
  eta: number; // tick of arrival at the discharge port at the current speed and route
  blockedAt: string | null; // chokepoint id the ship is waiting at
  waitUntil: number | null;
  anchorUntil: number | null;
  norTick: number | null; // notice of readiness at the discharge port
  berthTick: number | null;
  detour: string | null;
  cleared: string[]; // chokepoints this voyage has already been let through
  decision: { chokepoint: string; choice: "proceed" | "reroute"; proceedUsd: number; rerouteUsd: number; tick: number } | null; // the last passage decision and what each option cost
  loadEnd: number | null;
  dischargeEnd: number | null;
  trail: [number, number, number][]; // [tick, lon, lat], the last two days
}
export interface ChokepointState { id: string; status: "open" | "restricted" | "closed"; since: number; note: string }
export interface Refinery {
  capacityKbd: number;
  runs: number; // share of capacity, 0 to 1
  slate: Grade;
  shutUntil: number | null; // a hurricane or a fire
  maintenanceUntil: number | null; // a turnaround: runs capped at 0.5
  marginUsd: number; // realised since the level began
  daysRun: number;
  history: { day: number; runs: number; crudeBbl: number; marginUsd: number; marginPerBbl: number; crack321: number }[];
  base: number; // the forward margin marked at the last settle (always 0: the plant's margin is realised daily)
  pendingSlate: Grade | null; // a slate change takes effect at the next day's run
}
export interface Signal {
  id: string;
  kind: "tanker_cluster" | "transits" | "hotspot" | "cold_forecast";
  label: string;
  place: string;
  lon: number;
  lat: number;
  unit: string;
  baseline: number;
  offset: number; // the shift the coming event puts into the series by the time it fires
  cadenceHours: number; // 24 for a daily series, 1 for a hotspot feed
  leadTicks: number; // how long before the event the series starts to move
  eventId: string; // the scheduled event this series runs ahead of
  eventTick: number;
  firstMoveTick: number; // when the series left its baseline
  headlineTick: number | null; // when the headline reached the screen
  inst: InstrumentId; // the contract the signal bears on
  direction: "up" | "down"; // the way that contract should move when the event lands
  series: { tick: number; v: number }[];
  lagNote: string;
  what: string; // what the series can and cannot tell you
}
export interface LetterOfCredit { id: string; cargoId: string; beneficiary: string; faceUsd: number; feeUsd: number; openedTick: number; closedTick: number | null }
export interface Parcel { id: string; grade: Grade | "BLEND"; label: string; bbl: number; api: number; sulphur: number; costPerBbl: number; cargoId: string | null; benchmark: Basis; base: Record<string, number> }
export interface Tank {
  id: string;
  port: string;
  capacityBbl: number;
  costPerBblMonth: number;
  currency: "USD" | "EUR";
  leasedTick: number;
  months: number; // minimum term
  nextChargeTick: number;
  chargesPaid: number;
  fillRateBblPerDay: number;
  parcels: Parcel[];
  released: boolean;
}
export interface CounterpartyState {
  id: string;
  rating: string;
  ratingScore: number; // 0..100, AAA = 95
  edgeAdj: number; // added to the counterparty's differential edge after disputes
  disputes: number;
  late: number;
  defaulted: boolean;
  gone: boolean;
  dealsWithPlayer: number;
  note: string;
}

export interface State {
  version: 1;
  seed: number;
  tick: number;
  startDay: number;
  world: WorldState;
  factors: Factors;
  contracts: Record<string, Contract>; // key `${inst}:${month}`
  listed: Record<InstrumentId, MonthKey[]>;
  quotes: Record<string, Quote>;
  lots: Lot[];
  orders: Order[];
  fills: Fill[];
  finance: FinanceState;
  pnl: PnlState;
  risk: RiskState;
  news: NewsItem[];
  releases: Release[];
  events: ScheduledEvent[];
  level: LevelState;
  cargoes: Cargo[];
  tenders: Tender[];
  vessels: Vessel[];
  voyages: Voyage[];
  chokepoints: Record<string, ChokepointState>;
  portCongestion: Record<string, number>; // port -> tick until which the berth is taken
  lcs: LetterOfCredit[];
  tanks: Tank[];
  counterparties: Record<string, CounterpartyState>;
  infoDelayHours: number; // tier knob: how long after a shock its headline arrives
  refinery: Refinery | null;
  signals: Signal[];
  feedBought: boolean; // the assessment and signals feed costs money
  fx0: number; // EURUSD at the level start: the base for the FX leg on EUR-priced cargo legs
  depthScale: number; // tier knob: 1 = normal depth; thin back months in tier 4
  history: { factors: Factors; day: number }[]; // daily closes of the factors, oldest first (pre-history then live)
  counters: { lot: number; order: number; fill: number; ledger: number; news: number; cargo: number; tender: number; voyage: number; claim: number; lc: number; tank: number; parcel: number };
  pendingNewsDelay: number; // set while a delayed event fires: its headlines publish this many hours later
  capital: number;
  paused: { reason: string; tick: number } | null; // the last auto-pause the engine asked for
}

// ---------------------------------------------------------------- actions
export type ActionType =
  | "order" | "spread" | "roll" | "close" | "cancel_order"
  | "draw_line" | "repay_line" | "post_margin" | "convert_fx"
  | "open_card" | "ask_mentor" | "answer_drill" | "answer_quiz"
  | "end_level" | "request_limit"
  | "accept_tender" | "decline_tender" | "fix_charter" | "instruct_ship" | "efp" | "settle_claim" | "contest_claim"
  | "open_lc" | "insure" | "counter_tender" | "lease_tank" | "store_cargo" | "blend" | "release_tank"
  | "option_order" | "option_strategy" | "set_runs" | "set_slate" | "book_regas" | "buy_feed";

interface Base { player: PlayerId }
export type Action =
  | (Base & { type: "order"; inst: InstrumentId; month: MonthKey; side: "buy" | "sell"; qty: number; kind: "market" | "limit" | "stop"; price?: number; tag?: LegTag })
  | (Base & { type: "spread"; name: "time" | "inter" | "crack321"; legs: { inst: InstrumentId; month: MonthKey; side: "buy" | "sell"; qty: number }[] })
  | (Base & { type: "roll"; inst: InstrumentId; from: MonthKey; to: MonthKey })
  | (Base & { type: "close"; inst: InstrumentId; month: MonthKey })
  | (Base & { type: "cancel_order"; orderId: string })
  | (Base & { type: "draw_line"; amount: number })
  | (Base & { type: "repay_line"; amount: number })
  | (Base & { type: "post_margin"; amount: number })
  | (Base & { type: "convert_fx"; eur: number })
  | (Base & { type: "open_card"; cardId: string })
  | (Base & { type: "ask_mentor"; topic: string })
  | (Base & { type: "answer_drill"; drillId: string; answer: number })
  | (Base & { type: "answer_quiz"; questionId: string; choice: number })
  | (Base & { type: "end_level" })
  | (Base & { type: "request_limit"; limit: keyof RiskLimits; value: number })
  | (Base & { type: "accept_tender"; tenderId: string; cargoId?: string; prepay?: boolean })
  | (Base & { type: "decline_tender"; tenderId: string; reason?: string })
  | (Base & { type: "open_lc"; cargoId: string })
  | (Base & { type: "insure"; cargoId: string })
  | (Base & { type: "counter_tender"; tenderId: string; diff: number })
  | (Base & { type: "lease_tank"; port: string; bbl: number; months: number })
  | (Base & { type: "store_cargo"; cargoId: string; tankId: string })
  | (Base & { type: "blend"; tankId: string; parcelIds: string[] })
  | (Base & { type: "release_tank"; tankId: string })
  | (Base & { type: "option_order"; inst: InstrumentId; month: MonthKey; strike: number; kind: "call" | "put"; side: "buy" | "sell"; qty: number; tag?: LegTag })
  | (Base & { type: "option_strategy"; name: "collar" | "put_spread" | "call_spread" | "straddle" | "strangle"; inst: InstrumentId; month: MonthKey; strikes: number[]; qty: number; side: "buy" | "sell"; tag?: LegTag })
  | (Base & { type: "set_runs"; runs: number })
  | (Base & { type: "set_slate"; grade: Grade })
  | (Base & { type: "book_regas"; cargoId: string })
  | (Base & { type: "buy_feed" })
  | (Base & { type: "fix_charter"; cargoId: string; vesselId: string })
  | (Base & { type: "instruct_ship"; cargoId: string; speedFactor?: number; passage?: "proceed" | "reroute"; anchorDays?: number })
  | (Base & { type: "efp"; cargoId: string; leg: "purchase" | "sale" })
  | (Base & { type: "settle_claim"; cargoId: string; claimId: string })
  | (Base & { type: "contest_claim"; cargoId: string; claimId: string });

export interface Refusal {
  action: Action;
  reason: string;
  tick: number;
}

export type EngineEventKind =
  | "fill" | "order_rested" | "order_cancelled" | "settle" | "session_close" | "margin_call" | "margin_met" | "liquidation"
  | "news" | "event" | "release" | "card" | "mentor" | "limit_warning" | "forced_reduction" | "life_lost"
  | "level_passed" | "level_failed" | "level_ended" | "expiry" | "drill" | "quiz" | "objective" | "pause"
  | "tender" | "cargo" | "voyage" | "arrival" | "claim" | "chokepoint" | "finance" | "credit" | "storage" | "rumour" | "refinery" | "signal" | "option";

export interface EngineEvent {
  kind: EngineEventKind;
  tick: number;
  text: string;
  data?: Record<string, unknown>;
  pause?: boolean; // the clock should auto-pause on this event
}

export interface TickResult {
  state: State;
  refused: Refusal[];
  events: EngineEvent[];
}

/** A player's log entry: the actions submitted at a tick. */
export interface LogEntry { tick: number; actions: Action[] }
