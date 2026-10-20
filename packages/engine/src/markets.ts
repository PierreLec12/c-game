/**
 * Fair values and quotes for every instrument from the world state (section 5.2): the factor model,
 * the curve builder, the vol surface. Every contract price is a sum of named factors, so P&L
 * attribution (pnl.ts) is exact by construction.
 *
 *   BRENT(tau) = brentPrompt + S_brent(tau)
 *   WTI(tau)   = brentPrompt - bw + S_wti(tau)
 *   RBOB(tau)  = (brentPrompt - bw + gasolineCrack) / 42 + S_rbob(tau)
 *   ULSD(tau)  = (brentPrompt - bw + dieselCrack) / 42 + S_ulsd(tau)
 *   HH(tau)    = hhPrompt + S_hh(tau)
 *   TTF(tau)   = ttfPrompt + S_ttf(tau)   (EUR)
 *
 * tau is months to expiry; S(tau) is the cumulative structure built from the front monthly spread
 * (spread1, the most volatile point) decaying by `structureDecay` per month. Contango is bounded by
 * full carry (storage plus finance); backwardation steepens with prompt tightness.
 */
import { CLOCK, CONVERSIONS, FACTORS, INSTRUMENTS, INSTRUMENT_VOL_MULT, LIQUIDITY, STORAGE_COST, VOL_REGIMES, type InstrumentId } from "./refdata";
import type { Stream } from "./rng";
import type { Factors, Quote, Regime, WorldState } from "./types";
import { season } from "./calendar";
import { GRADES, QUALITY_GRID, type Grade } from "./world_data";

export const ALL_INSTRUMENTS: InstrumentId[] = ["BRENT", "WTI", "RBOB", "ULSD", "HH", "TTF", "DUBAI"];

export interface FactorInit { brentRef?: number; hhRef?: number; ttfRef?: number; eurusd?: number; spread1?: Partial<Record<InstrumentId, number>>; bw?: number; gasolineCrack?: number; dieselCrack?: number }

const hourWeights = (() => {
  const w = CLOCK.hourVolProfile.value;
  const norm = Math.sqrt(24 / w.reduce((a, x) => a + x * x, 0));
  return w.map((x) => x * norm);
})();

export function storageCostFor(inst: InstrumentId): number {
  // $/unit/month: crude at Rotterdam (Brent) or Cushing (WTI); products at Rotterdam per gal; gas stylised
  switch (inst) {
    case "BRENT": return STORAGE_COST.ROTTERDAM.value;
    case "WTI": return STORAGE_COST.CUSHING.value;
    case "RBOB": case "ULSD": return STORAGE_COST.ROTTERDAM.value / CONVERSIONS.GAL_PER_BBL.value;
    case "HH": return 0.08;
    case "TTF": return 0.9;
    case "DUBAI": return STORAGE_COST.FUJAIRAH.value;
  }
}

/** Full carry for one month: storage plus financing of the price at the base rate. */
export function fullCarry(inst: InstrumentId, price: number, rate: number): number {
  return storageCostFor(inst) + (price * rate) / 12;
}

export function anchors(world: WorldState, f: Factors, refs: Required<Pick<FactorInit, "brentRef" | "hhRef" | "ttfRef">>, day: number) {
  const F = FACTORS;
  const { summer, winter } = season(day);
  const logBrent = Math.log(refs.brentRef) - F.anchorInventoryElasticity.value * world.oecdInvGap + F.anchorGeoElasticity.value * world.geo;
  const bw = Math.min(F.bwBase.value + 0.5, 2.0 + F.bwPerMbUS.value * world.usInvGap);
  const runsShort = Math.max(0, 0.9 - world.refineryRuns);
  const gasolineCrack = F.gasolineCrackBase.value + F.crackSeasonAmplitude.value * (2 * summer - 1) - F.crackPerMbProductGap.value * world.productInvGap.gasoline + F.crackPerRunShare.value * runsShort;
  const dieselCrack = F.dieselCrackBase.value + F.crackSeasonAmplitude.value * (2 * winter - 1) - F.crackPerMbProductGap.value * world.productInvGap.distillate + F.crackPerRunShare.value * runsShort;
  const fuelOilCrack = F.fuelOilCrackBase.value - 0.2 * world.productInvGap.fuelOil;
  const logHh = Math.log(refs.hhRef) - F.hhPerBcfGap.value * world.gasStorageGap.us + F.hhPerHdd.value * world.hddAnomaly.us;
  const logTtf = Math.log(refs.ttfRef) - F.ttfPerTwhGap.value * world.gasStorageGap.eu + F.ttfPerHdd.value * world.hddAnomaly.eu - 0.05 * (world.lngArrivals - 1);
  const dubaiEW = F.dubaiEwBase.value + 2.0 * (world.geo - 0.2);
  // grade differentials on the quality grid: a sour grade cheapens when fuel oil weakens
  const gradeDiffs = {} as Record<Grade, number>;
  for (const g of Object.values(GRADES)) gradeDiffs[g.id] = g.baseDiff.value + 0.08 * QUALITY_GRID.usdPerSulphurPct.value * (f.fuelOilCrack - F.fuelOilCrackBase.value) * g.sulphur;
  const freightIndex = Math.max(0.4, Math.pow(world.freightDemand, 2));
  const spread1: Record<InstrumentId, number> = {
    BRENT: spreadTarget("BRENT", world.oecdInvGap, f.brentPrompt, world.baseRate),
    WTI: spreadTarget("WTI", world.usInvGap, f.brentPrompt - f.bw, world.baseRate),
    RBOB: spreadTarget("RBOB", world.productInvGap.gasoline, (f.brentPrompt - f.bw + f.gasolineCrack) / 42, world.baseRate),
    ULSD: spreadTarget("ULSD", world.productInvGap.distillate, (f.brentPrompt - f.bw + f.dieselCrack) / 42, world.baseRate),
    HH: spreadTarget("HH", world.gasStorageGap.us / 40, f.hhPrompt, world.baseRate),
    TTF: spreadTarget("TTF", world.gasStorageGap.eu / 4, f.ttfPrompt, world.baseRate),
    DUBAI: spreadTarget("DUBAI", world.oecdInvGap - 80 * (world.geo - 0.2), f.brentPrompt - f.dubaiEW, world.baseRate),
  };
  return { logBrent, bw, gasolineCrack, dieselCrack, fuelOilCrack, logHh, logTtf, dubaiEW, spread1, gradeDiffs, freightIndex };
}

/** Target front spread from the inventory gap: contango bounded by full carry, backwardation steeper with tightness. */
export function spreadTarget(inst: InstrumentId, gapMb: number, price: number, rate: number): number {
  const F = FACTORS;
  const carry = fullCarry(inst, price, rate);
  const scale = inst === "RBOB" || inst === "ULSD" ? 1 / 42 : inst === "HH" ? 0.05 : inst === "TTF" ? 0.5 : 1;
  if (gapMb >= 0) return Math.min(F.contangoPerMbSurplus.value * gapMb * scale, carry * 0.95);
  return Math.max(F.backwardationPerMbDeficit.value * gapMb * scale, -F.maxBackwardation.value * scale);
}

/** Cumulative structure from expiry (tau = 0) out to tau months. */
export function structure(spread1: number, tau: number): number {
  const d = FACTORS.structureDecay.value;
  const whole = Math.floor(tau);
  const frac = tau - whole;
  let s = 0;
  let m = 1;
  for (let i = 0; i < whole; i++) { s += spread1 * m; m *= d; }
  s += frac * spread1 * m;
  return s;
}

export function initFactors(world: WorldState, init: FactorInit, regime: Regime): Factors {
  const brentRef = init.brentRef ?? 75;
  const hhRef = init.hhRef ?? 3;
  const ttfRef = init.ttfRef ?? 35;
  const base: Factors = {
    brentPrompt: brentRef, bw: init.bw ?? 2.5, gasolineCrack: init.gasolineCrack ?? 12, dieselCrack: init.dieselCrack ?? 22, fuelOilCrack: -9,
    hhPrompt: hhRef, ttfPrompt: ttfRef, eurusd: init.eurusd ?? 1.08, dubaiEW: 1.5, datedDiff: 0.2,
    spread1: { BRENT: 0, WTI: 0, RBOB: 0, ULSD: 0, HH: 0.02, TTF: 0.3, DUBAI: 0 },
    vol: { BRENT: 0.3, WTI: 0.3, RBOB: 0.3, ULSD: 0.3, HH: 0.3, TTF: 0.3, DUBAI: 0.3 },
    gradeDiffs: Object.fromEntries(Object.values(GRADES).map((g) => [g.id, g.baseDiff.value])) as Record<Grade, number>,
    freightIndex: 1,
  };
  const a = anchors(world, base, { brentRef, hhRef, ttfRef }, 0);
  base.brentPrompt = Math.exp(a.logBrent);
  base.bw = a.bw;
  base.gasolineCrack = a.gasolineCrack;
  base.dieselCrack = a.dieselCrack;
  base.fuelOilCrack = a.fuelOilCrack;
  base.hhPrompt = Math.exp(a.logHh);
  base.ttfPrompt = Math.exp(a.logTtf);
  base.dubaiEW = a.dubaiEW;
  base.gradeDiffs = a.gradeDiffs;
  base.freightIndex = a.freightIndex;
  base.spread1 = { ...a.spread1, ...(init.spread1 ?? {}) };
  base.vol = volSurface(world, regime, 0);
  return base;
}

export function volSurface(world: WorldState, regime: Regime, releaseProximity: number): Record<InstrumentId, number> {
  const base = VOL_REGIMES.value[regime];
  const mult = 1 + FACTORS.volGeoElasticity.value * world.geo + Math.min(1, world.eventIntensity) + 0.15 * releaseProximity;
  const out = {} as Record<InstrumentId, number>;
  for (const inst of ALL_INSTRUMENTS) out[inst] = base * INSTRUMENT_VOL_MULT.value[inst] * mult;
  return out;
}

/** Implied vol for a tenor (months) with a mild downward term structure and a put skew in vol points per 10% moneyness. */
export function impliedVolAt(front: number, tauMonths: number, moneyness = 0): number {
  const term = 1 / Math.sqrt(1 + 0.15 * Math.max(0, tauMonths - 1));
  const skew = -0.08 * moneyness * 10; // puts richer: 0.8 vol points per 1% below the forward
  return Math.max(0.05, front * term + skew * 0.01);
}

export interface HourStep { hour: number; day: number; regime: Regime; releaseProximity: number }

/** One trading hour of price dynamics. Returns new factors. Daily-published factors (datedDiff) are updated in stepFactorsDaily. */
export function stepFactorsHourly(f: Factors, world: WorldState, s: Stream, refs: Required<Pick<FactorInit, "brentRef" | "hhRef" | "ttfRef">>, step: HourStep): Factors {
  const F = FACTORS;
  const a = anchors(world, f, refs, step.day);
  const w = hourWeights[step.hour];
  const vol = volSurface(world, step.regime, step.releaseProximity);
  const thetaH = F.flatMeanReversionPerDay.value / 24;
  const sqrtH = Math.sqrt(1 / (CONVERSIONS.TRADING_DAYS.value * 24));
  const dof = 4;
  const logStep = (x: number, logAnchor: number, sigmaAnn: number) => {
    const dz = s.studentT(dof) * sigmaAnn * sqrtH * w;
    return Math.exp(Math.log(x) + thetaH * (logAnchor - Math.log(x)) + dz);
  };
  const brentPrompt = logStep(f.brentPrompt, a.logBrent, vol.BRENT);
  const hhPrompt = logStep(f.hhPrompt, a.logHh, vol.HH);
  const ttfPrompt = logStep(f.ttfPrompt, a.logTtf, vol.TTF);
  const ouH = (x: number, target: number, thetaDay: number, noiseDay: number) => x + (thetaDay / 24) * (target - x) + (noiseDay / Math.sqrt(24)) * w * s.normal();
  let bw = ouH(f.bw, a.bw, F.bwMeanReversionPerDay.value, F.bwNoisePerDay.value);
  // the transatlantic arb: Brent cannot stay above WTI by more than the cost of shipping a barrel for long
  const arbCap = F.bwBase.value + 0.5;
  if (bw > arbCap) bw -= 0.3 * (bw - arbCap);
  const gasolineCrack = ouH(f.gasolineCrack, a.gasolineCrack, F.crackMeanReversionPerDay.value, F.crackNoisePerDay.value * (vol.RBOB / 0.39));
  const dieselCrack = ouH(f.dieselCrack, a.dieselCrack, F.crackMeanReversionPerDay.value, F.crackNoisePerDay.value * (vol.ULSD / 0.36));
  const fuelOilCrack = ouH(f.fuelOilCrack, a.fuelOilCrack, F.crackMeanReversionPerDay.value, F.crackNoisePerDay.value * 0.6);
  const eurusd = f.eurusd * Math.exp(F.fxVol.value * sqrtH * w * s.normal());
  const dubaiEW = ouH(f.dubaiEW, a.dubaiEW, 0.1, 0.1);
  const gradeDiffs = {} as Record<Grade, number>;
  for (const g of Object.keys(a.gradeDiffs) as Grade[]) gradeDiffs[g] = ouH(f.gradeDiffs[g] ?? a.gradeDiffs[g], a.gradeDiffs[g], 0.1, 0.04);
  const freightIndex = Math.max(0.3, ouH(f.freightIndex, a.freightIndex, 0.15, 0.02));
  const spread1 = {} as Record<InstrumentId, number>;
  for (const inst of ALL_INSTRUMENTS) {
    const scale = inst === "RBOB" || inst === "ULSD" ? 1 / 42 : inst === "HH" ? 0.05 : inst === "TTF" ? 0.5 : 1;
    const price = inst === "BRENT" ? brentPrompt : inst === "WTI" ? brentPrompt - bw : inst === "RBOB" ? (brentPrompt - bw + gasolineCrack) / 42 : inst === "ULSD" ? (brentPrompt - bw + dieselCrack) / 42 : inst === "HH" ? hhPrompt : inst === "DUBAI" ? brentPrompt - dubaiEW : ttfPrompt;
    const carry = fullCarry(inst, price, world.baseRate);
    const noise = F.spreadNoisePerDay.value * scale * (vol[inst] / 0.3);
    let x = ouH(f.spread1[inst], a.spread1[inst], F.spreadMeanReversionPerDay.value, noise);
    // contango is bounded by full carry: above 90% of carry the pull back is strong, and never beyond carry plus the noise band
    if (x > carry * 0.9) x -= 0.5 * (x - carry * 0.9);
    const band = F.carryNoiseBand.value * scale;
    x = Math.min(x, carry + band);
    x = Math.max(x, -F.maxBackwardation.value * scale);
    spread1[inst] = x;
  }
  return { ...f, brentPrompt, hhPrompt, ttfPrompt, bw, gasolineCrack, dieselCrack, fuelOilCrack, eurusd, dubaiEW, spread1, vol, gradeDiffs, freightIndex };
}

/** Daily publications: Dated minus front, from prompt tightness. */
export function stepFactorsDaily(f: Factors, world: WorldState, s: Stream): Factors {
  const target = 0.2 - FACTORS.datedDiffPerMb.value * world.oecdInvGap;
  const datedDiff = f.datedDiff + 0.3 * (target - f.datedDiff) + 0.05 * s.normal();
  return { ...f, datedDiff };
}

export interface PriceParts { price: number; parts: Record<string, number> }

/** The contract price and its named factor parts for `inst` at `tau` months to expiry. */
export function priceParts(f: Factors, inst: InstrumentId, tau: number): PriceParts {
  const g = CONVERSIONS.GAL_PER_BBL.value;
  let parts: Record<string, number>;
  switch (inst) {
    case "BRENT": parts = { flat: f.brentPrompt, time_spread: structure(f.spread1.BRENT, tau) }; break;
    case "WTI": parts = { flat: f.brentPrompt, basis: -f.bw, time_spread: structure(f.spread1.WTI, tau) }; break;
    case "RBOB": parts = { flat: f.brentPrompt / g, basis: -f.bw / g, crack: f.gasolineCrack / g, time_spread: structure(f.spread1.RBOB, tau) }; break;
    case "ULSD": parts = { flat: f.brentPrompt / g, basis: -f.bw / g, crack: f.dieselCrack / g, time_spread: structure(f.spread1.ULSD, tau) }; break;
    case "HH": parts = { flat: f.hhPrompt, time_spread: structure(f.spread1.HH, tau) }; break;
    case "TTF": parts = { flat: f.ttfPrompt, time_spread: structure(f.spread1.TTF, tau) }; break;
    case "DUBAI": parts = { flat: f.brentPrompt, basis: -f.dubaiEW, time_spread: structure(f.spread1.DUBAI, tau) }; break;
  }
  const price = Object.values(parts).reduce((a, b) => a + b, 0);
  return { price, parts };
}

export function roundToTick(x: number, tick: number): number {
  return Math.round(x / tick) * tick;
}

/** The bid, ask and depth of one contract from its mid, the listed-month index, the hour and the regime. */
export function makeQuote(inst: InstrumentId, month: string, mid: number, monthIdx: number, hour: number, regime: Regime, open: boolean, at: number, impact: number): Quote {
  const spec = INSTRUMENTS[inst];
  const L = LIQUIDITY;
  const hourSpread = L.hourSpread.value[hour];
  const spreadTicks = Math.max(1, Math.round(spec.baseSpreadTicks.value * Math.pow(1 + L.monthSpreadGrowth.value, monthIdx) * hourSpread * L.regimeSpread.value[regime]));
  const depth = Math.max(1, Math.round((spec.baseDepthLots.value * Math.pow(L.monthDepthDecay.value, monthIdx) * L.regimeDepth.value[regime]) / hourSpread));
  const half = (spreadTicks * spec.tick) / 2;
  const bid = roundToTick(mid - half, spec.tick);
  const ask = roundToTick(mid + half, spec.tick);
  const impactNote = Math.abs(impact) > spec.tick / 2 ? `; includes ${impact >= 0 ? "+" : ""}${impact.toFixed(spec.decimals)} of your own order impact, decaying` : "";
  const why = open
    ? `Mid ${mid.toFixed(spec.decimals)} from the factor model${impactNote}. Spread ${spreadTicks} tick${spreadTicks > 1 ? "s" : ""} (month ${monthIdx + 1} of 12, hour ${hour}:00 UTC, ${regime} regime). Depth ${depth} lots each side at the touch.`
    : `Market closed (weekend or holiday): last mid ${mid.toFixed(spec.decimals)}; orders rest until the open.`;
  return { inst, month, mid, bid: Math.max(bid, spec.tick), ask: Math.max(ask, spec.tick * 2), depth, spreadTicks, at, open, why };
}
