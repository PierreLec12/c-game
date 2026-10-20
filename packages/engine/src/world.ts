/**
 * The latent world state (section 5.2). Prices are observations of this with noise and friction.
 * Daily dynamics: Ornstein-Uhlenbeck pulls toward scenario targets; balances integrate into inventories.
 */
import { FACTORS } from "./refdata";
import type { Stream } from "./rng";
import type { Regime, WorldState } from "./types";

export interface WorldInit {
  crudeBalance?: number;
  oecdInvGap?: number;
  usInvGap?: number;
  productInvGap?: { gasoline: number; distillate: number; fuelOil: number };
  refineryRuns?: number;
  geo?: number;
  freightDemand?: number;
  gasStorageGap?: { us: number; eu: number };
  hddAnomaly?: { us: number; eu: number };
  lngArrivals?: number;
  regime?: Regime;
  baseRate?: number;
  targets?: Partial<WorldState["targets"]>;
}

export function initWorld(init: WorldInit = {}): WorldState {
  const targets: WorldState["targets"] = {
    crudeBalance: init.crudeBalance ?? 0,
    geo: init.geo ?? 0.2,
    refineryRuns: init.refineryRuns ?? 0.9,
    usGasGap: init.gasStorageGap?.us ?? 0,
    euGasGap: init.gasStorageGap?.eu ?? 0,
    hddUs: 0,
    hddEu: 0,
    freightDemand: init.freightDemand ?? 1,
    ...(init.targets ?? {}),
  };
  return {
    crudeBalance: init.crudeBalance ?? 0,
    oecdInvGap: init.oecdInvGap ?? 0,
    usInvGap: init.usInvGap ?? 0,
    productInvGap: init.productInvGap ?? { gasoline: 0, distillate: 0, fuelOil: 0 },
    refineryRuns: init.refineryRuns ?? 0.9,
    geo: init.geo ?? 0.2,
    freightDemand: init.freightDemand ?? 1,
    gasStorageGap: init.gasStorageGap ?? { us: 0, eu: 0 },
    hddAnomaly: init.hddAnomaly ?? { us: 0, eu: 0 },
    lngArrivals: init.lngArrivals ?? 1,
    regime: init.regime ?? "normal",
    eventIntensity: 0,
    baseRate: init.baseRate ?? 0.04,
    targets,
  };
}

const ou = (x: number, target: number, theta: number, noise: number) => x + theta * (target - x) + noise;

/** One calendar day of latent dynamics. `base` is the level's regime before event stress. */
export function stepWorldDaily(w: WorldState, s: Stream, baseRegime: Regime, winter: number): WorldState {
  const F = FACTORS;
  const crudeBalance = ou(w.crudeBalance, w.targets.crudeBalance, 0.15, s.normal() * 60);
  const invNoise = F.inventoryNoisePerDay.value;
  const oecdInvGap = w.oecdInvGap + crudeBalance / 1000 + s.normal() * invNoise;
  const usInvGap = w.usInvGap + (0.3 * crudeBalance) / 1000 + s.normal() * invNoise * 0.6;
  const refineryRuns = ou(w.refineryRuns, w.targets.refineryRuns, 0.2, s.normal() * 0.004);
  // products: runs above 0.9 build product stocks; seasonal demand draws gasoline in summer and distillate in winter
  const summer = 1 - winter;
  const productInvGap = {
    gasoline: ou(w.productInvGap.gasoline, 0, 0.03, 0) + (refineryRuns - 0.9) * 10 - (summer - 0.5) * 0.3 + s.normal() * 0.25,
    distillate: ou(w.productInvGap.distillate, 0, 0.03, 0) + (refineryRuns - 0.9) * 10 - (winter - 0.5) * 0.3 + s.normal() * 0.25,
    fuelOil: ou(w.productInvGap.fuelOil, 0, 0.03, 0) + (refineryRuns - 0.9) * 3 + s.normal() * 0.1,
  };
  const geo = Math.min(1, Math.max(0, ou(w.geo, w.targets.geo, F.geoMeanReversionPerDay.value, s.normal() * 0.01)));
  const freightDemand = ou(w.freightDemand, w.targets.freightDemand, 0.08, s.normal() * 0.01);
  const hddAnomaly = {
    us: ou(w.hddAnomaly.us, w.targets.hddUs, 0.25, s.normal() * 0.6),
    eu: ou(w.hddAnomaly.eu, w.targets.hddEu, 0.25, s.normal() * 0.6),
  };
  // gas storage: a cold anomaly drains storage faster; otherwise the gap mean-reverts to the scenario target
  const gasStorageGap = {
    us: ou(w.gasStorageGap.us, w.targets.usGasGap, 0.04, s.normal() * 1.5) - hddAnomaly.us * 1.2,
    eu: ou(w.gasStorageGap.eu, w.targets.euGasGap, 0.04, s.normal() * 0.6) - hddAnomaly.eu * 0.5,
  };
  const lngArrivals = ou(w.lngArrivals, 1, 0.1, s.normal() * 0.03);
  const eventIntensity = w.eventIntensity * F.eventIntensityDecayPerDay.value;
  const regime = regimeWithStress(baseRegime, eventIntensity, geo);
  return { ...w, crudeBalance, oecdInvGap, usInvGap, refineryRuns, productInvGap, geo, freightDemand, hddAnomaly, gasStorageGap, lngArrivals, eventIntensity, regime };
}

const ORDER: Regime[] = ["calm", "normal", "stressed", "crisis"];
export function regimeWithStress(base: Regime, eventIntensity: number, geo: number): Regime {
  let i = ORDER.indexOf(base);
  if (eventIntensity > 0.5 || geo > 0.7) i += 1;
  if (eventIntensity > 1.2 || geo > 0.9) i += 1;
  return ORDER[Math.min(ORDER.length - 1, i)];
}

export function applyWorldShock(w: WorldState, shock: Partial<Record<"crudeBalance" | "oecdInvGap" | "usInvGap" | "geo" | "refineryRuns" | "eventIntensity" | "gasUs" | "gasEu" | "hddUs" | "hddEu" | "gasoline" | "distillate" | "fuelOil", number>>, targets?: Partial<WorldState["targets"]>): WorldState {
  const n = { ...w, productInvGap: { ...w.productInvGap }, gasStorageGap: { ...w.gasStorageGap }, hddAnomaly: { ...w.hddAnomaly }, targets: { ...w.targets, ...(targets ?? {}) } };
  if (shock.crudeBalance) n.crudeBalance += shock.crudeBalance;
  if (shock.oecdInvGap) n.oecdInvGap += shock.oecdInvGap;
  if (shock.usInvGap) n.usInvGap += shock.usInvGap;
  if (shock.geo) n.geo = Math.min(1, Math.max(0, n.geo + shock.geo));
  if (shock.refineryRuns) n.refineryRuns += shock.refineryRuns;
  if (shock.eventIntensity) n.eventIntensity += shock.eventIntensity;
  if (shock.gasUs) n.gasStorageGap.us += shock.gasUs;
  if (shock.gasEu) n.gasStorageGap.eu += shock.gasEu;
  if (shock.hddUs) n.hddAnomaly.us += shock.hddUs;
  if (shock.hddEu) n.hddAnomaly.eu += shock.hddEu;
  if (shock.gasoline) n.productInvGap.gasoline += shock.gasoline;
  if (shock.distillate) n.productInvGap.distillate += shock.distillate;
  if (shock.fuelOil) n.productInvGap.fuelOil += shock.fuelOil;
  return n;
}
