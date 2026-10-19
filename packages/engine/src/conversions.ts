/**
 * Unit conversions and the maths of the desk's mental arithmetic (ported from c-terminal cterm/prep/drills.py).
 */
import { CONVERSIONS } from "./refdata";

export const BBL_PER_T_CRUDE = CONVERSIONS.BBL_PER_T_CRUDE.value;
export const BBL_PER_T_GASOIL = CONVERSIONS.BBL_PER_T_GASOIL.value;
export const MMBTU_PER_MWH = CONVERSIONS.MMBTU_PER_MWH.value;
export const GAL_PER_BBL = CONVERSIONS.GAL_PER_BBL.value;
export const TRADING_DAYS_PER_YEAR = CONVERSIONS.TRADING_DAYS.value;

export const galToBbl = (usdPerGal: number): number => usdPerGal * GAL_PER_BBL;
export const bblToGal = (usdPerBbl: number): number => usdPerBbl / GAL_PER_BBL;
export const tonneToBblCrude = (usdPerT: number): number => usdPerT / BBL_PER_T_CRUDE;
export const bblToTonneCrude = (usdPerBbl: number): number => usdPerBbl * BBL_PER_T_CRUDE;
export const tonneToBblGasoil = (usdPerT: number): number => usdPerT / BBL_PER_T_GASOIL;
export const eurMwhToUsdMmbtu = (eurPerMwh: number, eurusd: number): number => (eurPerMwh * eurusd) / MMBTU_PER_MWH;
export const usdMmbtuToEurMwh = (usdPerMmbtu: number, eurusd: number): number => (usdPerMmbtu * MMBTU_PER_MWH) / eurusd;
export const kbdToKtPerYear = (kbd: number): number => (kbd * 365) / BBL_PER_T_CRUDE;
export const crack321 = (rbobGal: number, ulsdGal: number, wtiBbl: number): number => (2 * rbobGal * GAL_PER_BBL + ulsdGal * GAL_PER_BBL - 3 * wtiBbl) / 3;
export const dailyMove = (price: number, volAnnual: number): number => (price * volAnnual) / Math.sqrt(TRADING_DAYS_PER_YEAR);
export const carryPerMonth = (price: number, ratePct: number, storage: number, contango: number): number => contango - storage - (price * ratePct) / 100 / 12;
/** Lots to hedge `barrels` at `lot` barrels per lot, rounded to the nearest lot. */
export const lotsFor = (barrels: number, lot = 1000): number => Math.round(barrels / lot);
