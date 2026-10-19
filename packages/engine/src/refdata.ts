/**
 * Every stylised parameter of the game, each with the day it was chosen and what it was based on.
 * Nothing here is a market figure. The UI labels any of these "stylised" wherever a player could
 * mistake it for a real number (section 0 and non-negotiable 5 of the prompt).
 */

export interface Stylised<T> {
  value: T;
  chosen: string; // ISO date
  basis: string; // what it was based on
  stylised: true;
}

const S = <T>(value: T, basis: string, chosen = "2026-10-19"): Stylised<T> => ({ value, chosen, basis, stylised: true });

export const NOTE = "stylised game parameter, chosen 2026-10-19 from public rules of thumb; not a market figure";

// ---------------------------------------------------------------- conversions (ported from c-terminal cterm/prep/drills.py)
export const CONVERSIONS = {
  BBL_PER_T_CRUDE: S(7.33, "world-average crude, the figure c-terminal's drills use"),
  BBL_PER_T_GASOIL: S(7.45, "gasoil, the figure c-terminal's drills use"),
  MMBTU_PER_MWH: S(3.412, "exact thermal conversion, 3.412 MMBtu per MWh"),
  GAL_PER_BBL: S(42, "US barrel"),
  TRADING_DAYS: S(252, "annualisation convention"),
  DAYS_PER_YEAR: S(365, "calendar days, for option time to expiry"),
};

// ---------------------------------------------------------------- instruments
export type InstrumentId = "BRENT" | "WTI" | "RBOB" | "ULSD" | "HH" | "TTF";
export type Family = "crude" | "products" | "gas";

export interface InstrumentSpec {
  id: InstrumentId;
  name: string;
  family: Family;
  unit: string; // price unit
  lot: number; // units per lot
  lotUnit: string;
  tick: number; // minimum price increment
  currency: "USD" | "EUR";
  decimals: number;
  initialMarginShare: Stylised<number>; // share of notional
  fee: Stylised<number>; // exchange + clearing fee per lot per side, USD
  dailyVolumeLots: Stylised<number>; // front-month, for the block rule
  baseSpreadTicks: Stylised<number>; // front, normal regime, European hours
  baseDepthLots: Stylised<number>; // at the touch, each side
  expiryRule: "brent" | "wti" | "products" | "hh" | "ttf";
  firstDeliveryMonthOffset: number; // months from a trade date's month to the first listed contract when nothing has expired
}

export const INSTRUMENTS: Record<InstrumentId, InstrumentSpec> = {
  BRENT: { id: "BRENT", name: "Brent crude", family: "crude", unit: "$/bbl", lot: 1000, lotUnit: "bbl", tick: 0.01, currency: "USD", decimals: 2,
    initialMarginShare: S(0.08, "section 14 of the prompt: crude 8%"), fee: S(1.5, "a typical all-in exchange plus clearing fee per lot per side"),
    dailyVolumeLots: S(250000, "order of magnitude of front-month Brent volume"), baseSpreadTicks: S(1, "one tick wide at the front"), baseDepthLots: S(60, "lots at the touch"),
    expiryRule: "brent", firstDeliveryMonthOffset: 2 },
  WTI: { id: "WTI", name: "WTI crude", family: "crude", unit: "$/bbl", lot: 1000, lotUnit: "bbl", tick: 0.01, currency: "USD", decimals: 2,
    initialMarginShare: S(0.08, "section 14: crude 8%"), fee: S(1.5, "as Brent"), dailyVolumeLots: S(300000, "order of magnitude"), baseSpreadTicks: S(1, "one tick"),
    baseDepthLots: S(70, "lots at the touch"), expiryRule: "wti", firstDeliveryMonthOffset: 1 },
  RBOB: { id: "RBOB", name: "RBOB gasoline", family: "products", unit: "$/gal", lot: 42000, lotUnit: "gal", tick: 0.0001, currency: "USD", decimals: 4,
    initialMarginShare: S(0.10, "section 14: products 10%"), fee: S(1.6, "as crude plus a little"), dailyVolumeLots: S(60000, "order of magnitude"), baseSpreadTicks: S(3, "three ticks"),
    baseDepthLots: S(20, "lots at the touch"), expiryRule: "products", firstDeliveryMonthOffset: 1 },
  ULSD: { id: "ULSD", name: "ULSD heating oil", family: "products", unit: "$/gal", lot: 42000, lotUnit: "gal", tick: 0.0001, currency: "USD", decimals: 4,
    initialMarginShare: S(0.10, "section 14: products 10%"), fee: S(1.6, "as RBOB"), dailyVolumeLots: S(60000, "order of magnitude"), baseSpreadTicks: S(3, "three ticks"),
    baseDepthLots: S(20, "lots at the touch"), expiryRule: "products", firstDeliveryMonthOffset: 1 },
  HH: { id: "HH", name: "Henry Hub gas", family: "gas", unit: "$/MMBtu", lot: 10000, lotUnit: "MMBtu", tick: 0.001, currency: "USD", decimals: 3,
    initialMarginShare: S(0.15, "section 14: HH 15%"), fee: S(1.4, "as crude"), dailyVolumeLots: S(150000, "order of magnitude"), baseSpreadTicks: S(1, "one tick"),
    baseDepthLots: S(40, "lots at the touch"), expiryRule: "hh", firstDeliveryMonthOffset: 1 },
  TTF: { id: "TTF", name: "TTF gas", family: "gas", unit: "EUR/MWh", lot: 720, lotUnit: "MWh", tick: 0.005, currency: "EUR", decimals: 3,
    initialMarginShare: S(0.20, "section 14: TTF 20%"), fee: S(1.2, "in USD equivalent"), dailyVolumeLots: S(40000, "order of magnitude"), baseSpreadTicks: S(2, "two ticks"),
    baseDepthLots: S(15, "lots at the touch"), expiryRule: "ttf", firstDeliveryMonthOffset: 1 },
};

export const TTF_LOT_NOTE = S(720, "the prompt says 1 MWh per lot-unit; the game trades a stylised 720 MWh lot (1 MW for a 30-day month) so a lot is a sensible size on screen. Recorded as a deviation.");

export const SPREAD_MARGIN_OFFSET = S(0.7, "section 14: spread offsets 60% to 80%; the game uses 70% for time spreads and 60% for inter-commodity spreads");
export const INTER_COMMODITY_OFFSET = S(0.6, "section 14: lower end of 60% to 80% for inter-commodity legs");
export const MAINTENANCE_MARGIN_SHARE = S(0.75, "maintenance margin as a share of initial margin: a common exchange convention");
export const BLOCK_SHARE_OF_VOLUME = S(0.02, "an order above 2% of the front month's daily volume is refused as a block (stylised)");

// ---------------------------------------------------------------- liquidity
export const LIQUIDITY = {
  monthSpreadGrowth: S(0.18, "spread widens 18% per listed month out from the front"),
  monthDepthDecay: S(0.78, "depth shrinks 22% per listed month out"),
  hourSpread: S([1.6, 1.5, 1.5, 1.4, 1.3, 1.3, 1.2, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.9, 0.9, 0.9, 0.9, 1.0, 1.1, 1.3, 1.5, 1.6, 1.6],
    "relative spread by UTC hour: thin in Asian hours and at the open, best in the London-New York overlap"),
  regimeDepth: S({ calm: 1.2, normal: 1.0, stressed: 0.5, crisis: 0.3 }, "depth halves in stress (section 5.3)"),
  regimeSpread: S({ calm: 0.9, normal: 1.0, stressed: 2.0, crisis: 3.5 }, "spread widens in stress"),
  slippagePerDepth: S(0.5, "a market order of size equal to the depth at the touch pays half a spread of slippage"),
  impactPerDepth: S(0.5, "an order of size equal to depth moves the mid by half a spread"),
  impactDecayPerTick: S(0.6, "60% of the impact remains after one tick"),
};

// ---------------------------------------------------------------- clock and sessions
export const CLOCK = {
  settleHour: S(19, "the daily settle is at 19:00 game time, near the ICE Brent settlement window"),
  hourVolProfile: S([0.6, 0.6, 0.65, 0.7, 0.7, 0.75, 0.9, 1.1, 1.2, 1.2, 1.1, 1.0, 1.1, 1.3, 1.4, 1.4, 1.3, 1.2, 1.1, 1.0, 0.8, 0.7, 0.65, 0.6],
    "relative price volatility by UTC hour; normalised so the squares sum to 24"),
  holidays: S(["01-01", "12-25", "12-26"], "stylised exchange holidays: New Year's Day, Christmas, Boxing Day"),
};

// ---------------------------------------------------------------- volatility regimes
export const VOL_REGIMES = S({ calm: 0.2, normal: 0.3, stressed: 0.55, crisis: 0.9 }, "section 14: annualised 20%, 30%, 55%, 90%");
export const INSTRUMENT_VOL_MULT = S({ BRENT: 1.0, WTI: 1.05, RBOB: 1.3, ULSD: 1.2, HH: 1.8, TTF: 2.0 }, "relative volatility by instrument: gas is wilder than crude");
export const STUDENT_T_DOF = S(4, "section 5.2: daily log returns have fat tails, Student-t with 4 degrees of freedom");

// ---------------------------------------------------------------- storage and carry
export const STORAGE_COST = {
  CUSHING: S(0.35, "section 14: $/bbl/month"),
  ROTTERDAM: S(0.6, "section 14"),
  FUJAIRAH: S(0.55, "section 14"),
  SINGAPORE: S(0.7, "section 14"),
};
export const FINANCE = {
  baseRate: S(0.04, "a starting base rate of 4% a year; the engine moves it"),
  lineSpreadBp: S(150, "section 14: plus 150 bp on the drawn part of the line"),
  lcFeePerQuarter: S(0.0025, "section 14: LC fee 0.25% of face per quarter"),
  covenantDrawdown: S(0.4, "a drawdown of 40% of capital breaches the covenant and cuts the line (stylised)"),
};

// ---------------------------------------------------------------- tiers
export const TIERS = S(
  { 1: { capital: 5e6, line: 20e6 }, 2: { capital: 20e6, line: 150e6 }, 3: { capital: 50e6, line: 400e6 } },
  "section 14: tier 1 $5m and $20m; tier 2 $20m and $150m; tier 3 onward $50m and $400m"
);
export const LIVES_PER_TIER = S(3, "section 7: three lives per tier");

// ---------------------------------------------------------------- chokepoints (reference list, labelled as such; shares are stylised)
export interface Chokepoint { id: string; name: string; lat: number; lon: number; shareOfSeaborneOil: Stylised<number> }
export const CHOKEPOINTS: Chokepoint[] = [
  { id: "HORMUZ", name: "Strait of Hormuz", lat: 26.6, lon: 56.4, shareOfSeaborneOil: S(0.2, "about a fifth of seaborne crude; a public rule of thumb") },
  { id: "BAB_EL_MANDEB", name: "Bab el-Mandeb", lat: 12.6, lon: 43.3, shareOfSeaborneOil: S(0.09, "under a tenth; rule of thumb") },
  { id: "SUEZ", name: "Suez Canal", lat: 30.4, lon: 32.3, shareOfSeaborneOil: S(0.09, "with SUMED, under a tenth") },
  { id: "MALACCA", name: "Strait of Malacca", lat: 2.5, lon: 101.5, shareOfSeaborneOil: S(0.25, "about a quarter; rule of thumb") },
  { id: "BOSPHORUS", name: "Bosphorus", lat: 41.1, lon: 29.1, shareOfSeaborneOil: S(0.03, "a few per cent") },
  { id: "DANISH", name: "Danish Straits", lat: 55.8, lon: 12.7, shareOfSeaborneOil: S(0.03, "a few per cent") },
  { id: "PANAMA", name: "Panama Canal", lat: 9.1, lon: -79.7, shareOfSeaborneOil: S(0.01, "small for crude; matters for LPG and LNG") },
  { id: "CAPE", name: "Cape of Good Hope", lat: -34.4, lon: 18.5, shareOfSeaborneOil: S(0.06, "the bypass; rises when Suez or the Red Sea shut") },
  { id: "GIBRALTAR", name: "Strait of Gibraltar", lat: 35.9, lon: -5.6, shareOfSeaborneOil: S(0.05, "a few per cent") },
  { id: "TAIWAN", name: "Taiwan Strait", lat: 24.5, lon: 119.5, shareOfSeaborneOil: S(0.1, "about a tenth of seaborne crude to north Asia") },
];
export const CHOKEPOINT_NOTE = "The chokepoint list follows the IMF PortWatch set c-terminal uses as a reference table; the shares are stylised rules of thumb, not measurements.";

// ---------------------------------------------------------------- factor-model coefficients (section 15 asks for these to be recorded)
export const FACTORS = {
  flatMeanReversionPerDay: S(0.04, "the flat price closes 4% of its gap to the anchor each trading day"),
  anchorInventoryElasticity: S(0.004, "log anchor falls 0.4% per million barrels of OECD surplus versus normal"),
  anchorGeoElasticity: S(0.18, "log anchor rises 18% when the geopolitics index goes from 0 to 1"),
  inventoryNoisePerDay: S(0.35, "mb a day of noise in the inventory gap"),
  spreadMeanReversionPerDay: S(0.12, "the front spread closes 12% of its gap to target each day"),
  spreadNoisePerDay: S(0.06, "$/bbl a day of noise on the front spread, the most volatile point of the curve"),
  contangoPerMbSurplus: S(0.012, "$/bbl/month of contango per mb of surplus"),
  backwardationPerMbDeficit: S(0.03, "$/bbl/month of backwardation per mb of deficit (steeper than contango: tightness bites)"),
  maxBackwardation: S(4.0, "$/bbl/month cap on the front spread in backwardation"),
  structureDecay: S(0.82, "each later monthly spread is 82% of the previous one"),
  carryNoiseBand: S(0.1, "$/bbl the contango may exceed full carry by, transiently"),
  bwBase: S(3.0, "Brent minus WTI base $/bbl: the stylised cost of moving a barrel from Houston to Rotterdam"),
  bwPerMbUS: S(0.05, "Brent minus WTI widens 5 cents per mb of US surplus"),
  bwMeanReversionPerDay: S(0.1, "BW closes 10% of its gap each day"),
  bwNoisePerDay: S(0.12, "$/bbl a day"),
  gasolineCrackBase: S(12, "$/bbl, with a summer premium"),
  dieselCrackBase: S(22, "$/bbl, with a winter premium"),
  fuelOilCrackBase: S(-9, "$/bbl, fuel oil is weak"),
  crackSeasonAmplitude: S(5, "$/bbl of seasonal swing"),
  crackPerMbProductGap: S(0.3, "$/bbl per mb of product surplus"),
  crackPerRunShare: S(40, "$/bbl of crack per unit of refinery run share below 0.9 (a turnaround strengthens the crack)"),
  crackMeanReversionPerDay: S(0.1, "cracks close 10% of their gap a day"),
  crackNoisePerDay: S(0.25, "$/bbl a day"),
  hhAnchor: S(3.0, "$/MMBtu base"),
  hhPerBcfGap: S(0.0025, "log HH falls 0.25% per bcf of storage surplus versus the five-year normal"),
  hhPerHdd: S(0.02, "log HH rises 2% per heating-degree-day anomaly"),
  ttfAnchor: S(35, "EUR/MWh base"),
  ttfPerTwhGap: S(0.01, "log TTF falls 1% per TWh of EU storage surplus"),
  ttfPerHdd: S(0.015, "log TTF rises 1.5% per HDD anomaly"),
  jkmPremium: S(1.5, "$/MMBtu Asian premium over TTF"),
  fxVol: S(0.06, "EURUSD annualised vol"),
  geoMeanReversionPerDay: S(0.05, "the geopolitics index decays 5% of its excess a day"),
  volGeoElasticity: S(0.6, "implied and realised vol rise 60% when geo goes from 0 to 1"),
  eventIntensityDecayPerDay: S(0.7, "70% of event intensity remains after a day"),
  releaseSurpriseElasticity: S(0.004, "log prompt moves 0.4% per mb of inventory surprise versus consensus, the wrong way"),
  datedDiffPerMb: S(0.02, "Dated minus front rises 2 cents per mb of deficit"),
  dubaiEwBase: S(1.5, "$/bbl Brent over Dubai base"),
};

export const VAR = {
  historyDays: S(260, "trading days of simulated pre-history for the historical VaR"),
  window: S(250, "section 7: one-day 95% VaR by historical simulation; a 250-day window"),
  level: S(0.95, "95%"),
};

export const STRESS_SHOCKS = S(
  [[-0.1, 0], [-0.05, 0], [0.05, 0], [0.1, 0], [0, 0.05], [0, -0.05], [-0.1, 0.05], [0.1, 0.05]] as [number, number][],
  "price and vol shocks, as c-terminal's book panel"
);
