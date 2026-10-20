/**
 * The stylised world (section 4): ports, the sea graph the ships sail on, chokepoints, vessel classes and the
 * named fleet, physical grades on a quality grid, and the counterparties. Everything here is stylised and says so;
 * coordinates are approximate and chosen so the routes stay off the 110m coastline.
 */
import { CHOKEPOINTS, type Stylised } from "./refdata";

const S = <T>(value: T, basis: string, chosen = "2026-10-20"): Stylised<T> => ({ value, chosen, basis, stylised: true });

export type VesselClass = "MR" | "LR2" | "AFRAMAX" | "SUEZMAX" | "VLCC" | "LNGC";
export type Grade = "ARAB_LIGHT" | "BASRAH_MEDIUM" | "FORTIES" | "BONNY_LIGHT" | "WTI_MIDLAND" | "URALS" | "ES_SIDER";
export type Basis = "DATED" | "BRENT" | "WTI" | "DUBAI";

export interface VesselClassSpec { cls: VesselClass; name: string; cargoKb: Stylised<number>; use: string; hireUsdPerDay: Stylised<number>; speedLaden: number; speedBallast: number; consumptionNote: string }
export const VESSEL_CLASSES: Record<VesselClass, VesselClassSpec> = {
  MR: { cls: "MR", name: "MR", cargoKb: S(300, "section 4 table"), use: "products, short haul", hireUsdPerDay: S(20000, "section 4 table"), speedLaden: 12.5, speedBallast: 13.5, consumptionNote: "hire covers bunkers in this stylised model" },
  LR2: { cls: "LR2", name: "LR2", cargoKb: S(650, "section 4 table"), use: "products, long haul", hireUsdPerDay: S(32000, "section 4 table"), speedLaden: 12.5, speedBallast: 13.5, consumptionNote: "" },
  AFRAMAX: { cls: "AFRAMAX", name: "Aframax", cargoKb: S(600, "section 4 table"), use: "North Sea, Med, USGC", hireUsdPerDay: S(35000, "section 4 table"), speedLaden: 12.5, speedBallast: 13.5, consumptionNote: "" },
  SUEZMAX: { cls: "SUEZMAX", name: "Suezmax", cargoKb: S(1000, "section 4 table"), use: "West Africa, Black Sea", hireUsdPerDay: S(45000, "section 4 table"), speedLaden: 12.5, speedBallast: 13.5, consumptionNote: "" },
  VLCC: { cls: "VLCC", name: "VLCC", cargoKb: S(2000, "section 4 table"), use: "Gulf to Asia, USGC to Asia", hireUsdPerDay: S(55000, "section 4 table"), speedLaden: 12.5, speedBallast: 13.5, consumptionNote: "" },
  LNGC: { cls: "LNGC", name: "LNG carrier", cargoKb: S(1100, "174,000 m3, about 3.6 TBtu; shown here as a stylised barrel-equivalent for sizing"), use: "LNG", hireUsdPerDay: S(80000, "section 4 table"), speedLaden: 16, speedBallast: 17, consumptionNote: "" },
};
const CLASS_ORDER: VesselClass[] = ["MR", "LR2", "AFRAMAX", "SUEZMAX", "VLCC", "LNGC"];
export const classAtLeast = (cls: VesselClass, min: VesselClass): boolean => CLASS_ORDER.indexOf(cls) >= CLASS_ORDER.indexOf(min);
export const classAtMost = (cls: VesselClass, max: VesselClass): boolean => CLASS_ORDER.indexOf(cls) <= CLASS_ORDER.indexOf(max);

export interface Port { id: string; name: string; lon: number; lat: number; maxClass: VesselClass; loads: Grade[]; discharge: boolean; storage: boolean; lng?: "load" | "discharge"; node: string; region: "NSEA" | "MED" | "GULF" | "WAF" | "USGC" | "ASIA" | "BALTIC" | "BLACK" | "INDIA" }
export const PORTS: Record<string, Port> = {
  RAS_TANURA: { id: "RAS_TANURA", name: "Ras Tanura", lon: 50.17, lat: 26.64, maxClass: "VLCC", loads: ["ARAB_LIGHT"], discharge: false, storage: false, node: "P_RAS_TANURA", region: "GULF" },
  BASRAH: { id: "BASRAH", name: "Basrah", lon: 48.3, lat: 29.75, maxClass: "VLCC", loads: ["BASRAH_MEDIUM"], discharge: false, storage: false, node: "P_BASRAH", region: "GULF" },
  FUJAIRAH: { id: "FUJAIRAH", name: "Fujairah", lon: 56.36, lat: 25.12, maxClass: "VLCC", loads: [], discharge: true, storage: true, node: "P_FUJAIRAH", region: "GULF" },
  ES_SIDER: { id: "ES_SIDER", name: "Es Sider", lon: 18.35, lat: 30.63, maxClass: "SUEZMAX", loads: ["ES_SIDER"], discharge: false, storage: false, node: "P_ES_SIDER", region: "MED" },
  BONNY: { id: "BONNY", name: "Bonny", lon: 7.1, lat: 4.2, maxClass: "VLCC", loads: ["BONNY_LIGHT"], discharge: false, storage: false, node: "P_BONNY", region: "WAF" },
  HOUSTON: { id: "HOUSTON", name: "Houston", lon: -94.7, lat: 29.3, maxClass: "AFRAMAX", loads: ["WTI_MIDLAND"], discharge: true, storage: false, node: "P_HOUSTON", region: "USGC" },
  CORPUS_CHRISTI: { id: "CORPUS_CHRISTI", name: "Corpus Christi", lon: -97.0, lat: 27.75, maxClass: "VLCC", loads: ["WTI_MIDLAND"], discharge: false, storage: false, node: "P_CORPUS", region: "USGC" },
  CUSHING: { id: "CUSHING", name: "Cushing", lon: -96.77, lat: 35.98, maxClass: "MR", loads: [], discharge: false, storage: true, node: "", region: "USGC" },
  ST_JAMES: { id: "ST_JAMES", name: "St James", lon: -90.85, lat: 30.05, maxClass: "AFRAMAX", loads: ["WTI_MIDLAND"], discharge: true, storage: true, node: "P_ST_JAMES", region: "USGC" },
  ROTTERDAM: { id: "ROTTERDAM", name: "Rotterdam", lon: 4.05, lat: 51.95, maxClass: "VLCC", loads: [], discharge: true, storage: true, node: "P_ROTTERDAM", region: "NSEA" },
  SULLOM_VOE: { id: "SULLOM_VOE", name: "Sullom Voe", lon: -1.28, lat: 60.46, maxClass: "SUEZMAX", loads: ["FORTIES"], discharge: false, storage: false, node: "P_SULLOM_VOE", region: "NSEA" },
  PRIMORSK: { id: "PRIMORSK", name: "Primorsk", lon: 28.7, lat: 60.35, maxClass: "AFRAMAX", loads: ["URALS"], discharge: false, storage: false, node: "P_PRIMORSK", region: "BALTIC" },
  NOVOROSSIYSK: { id: "NOVOROSSIYSK", name: "Novorossiysk", lon: 37.78, lat: 44.72, maxClass: "SUEZMAX", loads: ["URALS"], discharge: false, storage: false, node: "P_NOVOROSSIYSK", region: "BLACK" },
  SINGAPORE: { id: "SINGAPORE", name: "Singapore", lon: 103.8, lat: 1.26, maxClass: "VLCC", loads: [], discharge: true, storage: true, node: "P_SINGAPORE", region: "ASIA" },
  NINGBO: { id: "NINGBO", name: "Ningbo", lon: 122.1, lat: 29.9, maxClass: "VLCC", loads: [], discharge: true, storage: false, node: "P_NINGBO", region: "ASIA" },
  CHIBA: { id: "CHIBA", name: "Chiba", lon: 140.05, lat: 35.55, maxClass: "VLCC", loads: [], discharge: true, storage: false, node: "P_CHIBA", region: "ASIA" },
  JAMNAGAR: { id: "JAMNAGAR", name: "Jamnagar", lon: 69.7, lat: 22.4, maxClass: "VLCC", loads: [], discharge: true, storage: false, node: "P_JAMNAGAR", region: "INDIA" },
  SABINE_PASS: { id: "SABINE_PASS", name: "Sabine Pass", lon: -93.85, lat: 29.7, maxClass: "LNGC", loads: [], discharge: false, storage: false, lng: "load", node: "P_SABINE", region: "USGC" },
  FREEPORT: { id: "FREEPORT", name: "Freeport", lon: -95.3, lat: 28.93, maxClass: "LNGC", loads: [], discharge: false, storage: false, lng: "load", node: "P_FREEPORT", region: "USGC" },
  ZEEBRUGGE: { id: "ZEEBRUGGE", name: "Zeebrugge", lon: 3.2, lat: 51.35, maxClass: "LNGC", loads: [], discharge: true, storage: false, lng: "discharge", node: "P_ZEEBRUGGE", region: "NSEA" },
  GATE: { id: "GATE", name: "Gate (Rotterdam)", lon: 4.05, lat: 51.97, maxClass: "LNGC", loads: [], discharge: true, storage: false, lng: "discharge", node: "P_ROTTERDAM", region: "NSEA" },
  SODEGAURA: { id: "SODEGAURA", name: "Sodegaura", lon: 139.95, lat: 35.4, maxClass: "LNGC", loads: [], discharge: true, storage: false, lng: "discharge", node: "P_CHIBA", region: "ASIA" },
  SALDANHA_BAY: { id: "SALDANHA_BAY", name: "Saldanha Bay", lon: 17.95, lat: -33.05, maxClass: "VLCC", loads: [], discharge: true, storage: true, node: "P_SALDANHA", region: "WAF" },
};

/** Sea graph nodes: ports (P_), sea waypoints (W_) and chokepoints (C_), with lon/lat. */
export interface SeaNode { id: string; lon: number; lat: number; chokepoint?: string; kind: "port" | "waypoint" | "chokepoint" }
const N = (id: string, lon: number, lat: number, chokepoint?: string): SeaNode => ({ id, lon, lat, chokepoint, kind: id.startsWith("P_") ? "port" : chokepoint ? "chokepoint" : "waypoint" });
export const SEA_NODES: SeaNode[] = [
  // ports
  N("P_RAS_TANURA", 50.3, 26.7), N("P_BASRAH", 48.4, 29.6), N("P_FUJAIRAH", 56.5, 25.1), N("P_ES_SIDER", 18.4, 30.8), N("P_BONNY", 7.2, 4.0),
  N("P_HOUSTON", -94.5, 29.1), N("P_CORPUS", -96.8, 27.6), N("P_ST_JAMES", -89.4, 29.0), N("P_ROTTERDAM", 3.8, 52.1), N("P_SULLOM_VOE", -1.0, 60.6),
  N("P_PRIMORSK", 28.4, 60.2), N("P_NOVOROSSIYSK", 37.6, 44.5), N("P_SINGAPORE", 103.9, 1.1), N("P_NINGBO", 122.4, 29.8), N("P_CHIBA", 140.0, 35.2),
  N("P_JAMNAGAR", 69.4, 22.3), N("P_SABINE", -93.8, 29.4), N("P_FREEPORT", -95.2, 28.7), N("P_ZEEBRUGGE", 3.0, 51.5), N("P_SALDANHA", 17.6, -33.2),
  // North Sea, Channel, Atlantic Europe
  N("W_SHETLAND_E", 0.5, 60.2), N("W_NSEA_N", 1.5, 58.0), N("W_NSEA_S", 3.0, 54.5), N("W_NSEA_SW", 2.8, 52.6), N("C_DOVER", 1.5, 50.9, "DOVER"), N("W_CHANNEL_W", -5.0, 49.3),
  N("W_BISCAY", -9.0, 45.5), N("W_FINISTERRE", -10.5, 43.0), N("W_PORTUGAL", -10.2, 39.0), N("W_ST_VINCENT", -9.5, 36.5), N("C_GIBRALTAR", -5.6, 35.95, "GIBRALTAR"),
  // Mediterranean, Suez, Red Sea, Gulf
  N("W_ALBORAN", -1.5, 36.3), N("W_BALEARIC", 4.0, 37.9), N("W_SARDINIA_S", 9.0, 38.0), N("W_SICILY_CH", 11.8, 37.2), N("W_IONIAN", 18.0, 35.0), N("W_CRETE_S", 25.0, 34.2),
  N("W_PORT_SAID", 32.0, 31.8), N("C_SUEZ", 32.55, 30.0, "SUEZ"), N("W_GULF_SUEZ", 33.4, 27.8), N("W_RED_SEA_N", 35.0, 25.5), N("W_RED_SEA_M", 38.2, 20.5), N("W_RED_SEA_S", 41.6, 15.3),
  N("C_BAB_EL_MANDEB", 43.4, 12.5, "BAB_EL_MANDEB"), N("W_ADEN", 47.5, 12.2), N("W_SOCOTRA_E", 56.0, 13.2), N("W_OMAN_SE", 60.5, 19.5), N("W_OMAN_E", 60.2, 23.0),
  N("C_HORMUZ", 56.5, 26.5, "HORMUZ"), N("W_GULF_E", 54.5, 25.9), N("W_GULF_W", 52.3, 26.4), N("W_GULF_N", 49.8, 28.3),
  // India, Indian Ocean, Malacca, South China Sea, East Asia
  N("W_ARABIAN_E", 66.0, 20.5), N("W_KUTCH", 68.3, 22.0), N("W_IND_W", 68.0, 12.0), N("W_LAKSHADWEEP", 74.5, 7.0), N("W_SRI_LANKA_S", 80.5, 4.8), N("W_BENGAL_S", 88.0, 5.5), N("W_ACEH", 94.8, 6.1), N("W_MALACCA_N", 98.6, 4.9),
  N("C_MALACCA", 101.0, 2.7, "MALACCA"), N("W_SINGAPORE_E", 105.0, 2.0), N("W_SCS_S", 109.5, 6.5), N("W_SCS_M", 113.0, 13.0), N("W_SCS_N", 117.5, 20.0), N("C_TAIWAN", 119.8, 24.5, "TAIWAN"),
  N("W_ECS", 123.5, 28.5), N("W_RYUKYU", 129.0, 29.5), N("W_SHIKOKU_S", 134.5, 32.3), N("W_IZU", 139.0, 34.3),
  // Cape route and South Atlantic, Indian Ocean crossings
  N("W_CANARY", -17.0, 27.0), N("W_CAPE_VERDE_E", -18.5, 15.0), N("W_GUINEA_W", -14.5, 6.5), N("W_ATL_EQ", -6.0, -1.0), N("W_ATL_S1", 3.0, -18.0), N("W_ATL_S2", 10.0, -27.0),
  N("W_ATL_S3", 15.0, -33.0), N("C_CAPE", 18.3, -35.5, "CAPE"), N("W_LIBERIA_S", -9.0, 3.2), N("W_GHANA_S", -1.0, 2.8), N("W_GULF_GUINEA", 3.5, 2.0), N("W_ANGOLA_OFF", 6.5, -6.0), N("W_NAMIBIA_OFF", 9.5, -14.0), N("W_NAMIBIA_S", 10.5, -22.0),
  N("W_AGULHAS_E", 25.0, -36.5), N("W_MADAGASCAR_S", 46.0, -27.5), N("W_MADAGASCAR_E", 51.0, -23.5), N("W_MOZ_E", 52.0, -12.0), N("W_SOMALI_E", 56.0, 0.0), N("W_IND_C", 70.0, -20.0), N("W_IND_E", 88.0, -8.0), N("W_SUNDA_W", 95.5, 0.5),
  // Baltic and Black Sea
  N("W_GULF_FINLAND", 25.5, 59.8), N("W_GULF_FINLAND_W", 22.5, 59.5), N("W_BALTIC_C", 20.5, 58.0), N("W_BALTIC_S", 15.5, 55.3), N("C_DANISH", 12.7, 55.9, "DANISH"), N("W_KATTEGAT", 11.4, 57.2), N("W_SKAGEN", 10.9, 58.0), N("W_SKAGERRAK", 8.0, 57.9),
  N("W_BLACK_SEA", 35.5, 43.3), N("C_BOSPHORUS", 29.0, 41.1, "BOSPHORUS"), N("W_MARMARA", 27.8, 40.7), N("W_DARDANELLES", 26.0, 40.0), N("W_AEGEAN", 25.3, 38.2), N("W_CRETE_E", 27.0, 35.0),
  // Americas and Atlantic crossing
  N("W_GOM_C", -90.0, 26.5), N("W_GOM_E", -85.0, 25.5), N("C_FLORIDA", -80.2, 24.3, "FLORIDA"), N("W_BAHAMAS_E", -73.0, 27.5), N("W_ATL_W", -62.0, 33.0), N("W_ATL_M", -45.0, 41.0), N("W_ATL_E", -25.0, 46.0),
  N("W_ATL_SW", -50.0, 12.0), N("W_ATL_SC", -35.0, -2.0), N("W_ATL_SE", -20.0, -16.0), N("W_YUCATAN", -85.8, 21.8), N("W_CARIB", -80.0, 14.0), N("C_PANAMA", -79.9, 9.3, "PANAMA"), N("W_PANAMA_PAC", -79.5, 8.2), N("W_PANAMA_PAC2", -80.6, 6.6),
  N("W_PAC_E", -100.0, 10.0), N("W_PAC_C", -130.0, 20.0), N("W_PAC_W", -160.0, 28.0), N("W_PAC_DL", 179.9, 32.0), N("W_PAC_NW", 160.0, 34.0), N("W_PAC_J", 148.0, 34.5),
];

/** Edges of the sea graph (undirected). Distances are great-circle in nautical miles, computed at load. */
export const SEA_EDGES: [string, string][] = [
  // North Sea and Channel
  ["P_SULLOM_VOE", "W_SHETLAND_E"], ["W_SHETLAND_E", "W_NSEA_N"], ["W_NSEA_N", "W_NSEA_S"], ["W_NSEA_S", "W_NSEA_SW"], ["W_NSEA_SW", "P_ROTTERDAM"], ["W_NSEA_SW", "C_DOVER"], ["P_ROTTERDAM", "C_DOVER"],
  ["P_ZEEBRUGGE", "C_DOVER"], ["P_ZEEBRUGGE", "W_NSEA_SW"], ["C_DOVER", "W_CHANNEL_W"], ["W_CHANNEL_W", "W_BISCAY"], ["W_BISCAY", "W_FINISTERRE"], ["W_FINISTERRE", "W_PORTUGAL"], ["W_PORTUGAL", "W_ST_VINCENT"], ["W_ST_VINCENT", "C_GIBRALTAR"],
  // Med to Suez
  ["C_GIBRALTAR", "W_ALBORAN"], ["W_ALBORAN", "W_BALEARIC"], ["W_BALEARIC", "W_SARDINIA_S"], ["W_SARDINIA_S", "W_SICILY_CH"], ["W_SICILY_CH", "W_IONIAN"], ["W_IONIAN", "W_CRETE_S"], ["W_CRETE_S", "W_PORT_SAID"], ["W_PORT_SAID", "C_SUEZ"],
  ["C_SUEZ", "W_GULF_SUEZ"], ["W_GULF_SUEZ", "W_RED_SEA_N"], ["W_RED_SEA_N", "W_RED_SEA_M"], ["W_RED_SEA_M", "W_RED_SEA_S"], ["W_RED_SEA_S", "C_BAB_EL_MANDEB"], ["C_BAB_EL_MANDEB", "W_ADEN"], ["W_ADEN", "W_SOCOTRA_E"],
  ["P_ES_SIDER", "W_IONIAN"], ["W_CRETE_S", "W_CRETE_E"], ["W_CRETE_E", "W_AEGEAN"], ["W_AEGEAN", "W_DARDANELLES"], ["W_DARDANELLES", "W_MARMARA"], ["W_MARMARA", "C_BOSPHORUS"], ["C_BOSPHORUS", "W_BLACK_SEA"], ["W_BLACK_SEA", "P_NOVOROSSIYSK"],
  // Gulf
  ["W_SOCOTRA_E", "W_OMAN_SE"], ["W_OMAN_SE", "W_OMAN_E"], ["W_OMAN_E", "C_HORMUZ"], ["W_OMAN_E", "P_FUJAIRAH"], ["P_FUJAIRAH", "C_HORMUZ"], ["C_HORMUZ", "W_GULF_E"], ["W_GULF_E", "W_GULF_W"], ["W_GULF_W", "P_RAS_TANURA"], ["W_GULF_W", "W_GULF_N"], ["W_GULF_N", "P_BASRAH"],
  // India and the Indian Ocean to Asia
  ["W_OMAN_SE", "W_ARABIAN_E"], ["W_ARABIAN_E", "W_KUTCH"], ["W_KUTCH", "P_JAMNAGAR"], ["W_OMAN_SE", "W_IND_W"], ["W_IND_W", "W_LAKSHADWEEP"], ["W_LAKSHADWEEP", "W_SRI_LANKA_S"], ["W_SRI_LANKA_S", "W_BENGAL_S"], ["W_BENGAL_S", "W_ACEH"],
  ["W_ACEH", "W_MALACCA_N"], ["W_MALACCA_N", "C_MALACCA"], ["C_MALACCA", "P_SINGAPORE"], ["P_SINGAPORE", "W_SINGAPORE_E"], ["W_SINGAPORE_E", "W_SCS_S"], ["W_SCS_S", "W_SCS_M"], ["W_SCS_M", "W_SCS_N"], ["W_SCS_N", "C_TAIWAN"], ["C_TAIWAN", "W_ECS"], ["W_ECS", "P_NINGBO"],
  ["W_ECS", "W_RYUKYU"], ["W_RYUKYU", "W_SHIKOKU_S"], ["W_SHIKOKU_S", "W_IZU"], ["W_IZU", "P_CHIBA"],
  // Cape route
  ["W_FINISTERRE", "W_CANARY"], ["W_ST_VINCENT", "W_CANARY"], ["W_CANARY", "W_CAPE_VERDE_E"], ["W_CAPE_VERDE_E", "W_GUINEA_W"], ["W_GUINEA_W", "W_ATL_EQ"], ["W_ATL_EQ", "W_ATL_S1"], ["W_ATL_S1", "W_ATL_S2"], ["W_ATL_S2", "W_ATL_S3"], ["W_ATL_S3", "C_CAPE"],
  ["W_GUINEA_W", "W_LIBERIA_S"], ["W_LIBERIA_S", "W_GHANA_S"], ["W_GHANA_S", "W_GULF_GUINEA"], ["W_GULF_GUINEA", "P_BONNY"], ["P_BONNY", "W_ANGOLA_OFF"], ["W_GULF_GUINEA", "W_ANGOLA_OFF"], ["W_ANGOLA_OFF", "W_NAMIBIA_OFF"], ["W_NAMIBIA_OFF", "W_NAMIBIA_S"], ["W_NAMIBIA_S", "W_ATL_S3"], ["W_ATL_S3", "P_SALDANHA"], ["P_SALDANHA", "C_CAPE"],
  ["C_CAPE", "W_AGULHAS_E"], ["W_AGULHAS_E", "W_MADAGASCAR_S"], ["W_MADAGASCAR_S", "W_MADAGASCAR_E"], ["W_MADAGASCAR_E", "W_MOZ_E"], ["W_MOZ_E", "W_SOMALI_E"], ["W_SOMALI_E", "W_SOCOTRA_E"], ["W_SOMALI_E", "W_OMAN_SE"],
  ["W_MADAGASCAR_S", "W_IND_C"], ["W_IND_C", "W_IND_E"], ["W_IND_E", "W_SUNDA_W"], ["W_SUNDA_W", "W_ACEH"], ["W_IND_C", "W_SRI_LANKA_S"],
  // Baltic
  ["P_PRIMORSK", "W_GULF_FINLAND"], ["W_GULF_FINLAND", "W_GULF_FINLAND_W"], ["W_GULF_FINLAND_W", "W_BALTIC_C"], ["W_BALTIC_C", "W_BALTIC_S"], ["W_BALTIC_S", "C_DANISH"], ["C_DANISH", "W_KATTEGAT"], ["W_KATTEGAT", "W_SKAGEN"], ["W_SKAGEN", "W_SKAGERRAK"], ["W_SKAGERRAK", "W_NSEA_S"], ["W_SKAGERRAK", "W_NSEA_N"],
  // Americas
  ["P_HOUSTON", "W_GOM_C"], ["P_CORPUS", "W_GOM_C"], ["P_SABINE", "W_GOM_C"], ["P_FREEPORT", "W_GOM_C"], ["P_ST_JAMES", "W_GOM_C"], ["W_GOM_C", "W_GOM_E"], ["W_GOM_E", "C_FLORIDA"], ["C_FLORIDA", "W_BAHAMAS_E"], ["W_BAHAMAS_E", "W_ATL_W"],
  ["W_ATL_W", "W_ATL_M"], ["W_ATL_M", "W_ATL_E"], ["W_ATL_E", "W_BISCAY"], ["W_ATL_E", "W_CHANNEL_W"], ["W_BAHAMAS_E", "W_ATL_SW"], ["W_ATL_SW", "W_ATL_SC"], ["W_ATL_SC", "W_ATL_SE"], ["W_ATL_SE", "W_ATL_S2"], ["W_ATL_SW", "W_CAPE_VERDE_E"],
  ["W_GOM_C", "W_YUCATAN"], ["W_YUCATAN", "W_CARIB"], ["W_CARIB", "C_PANAMA"], ["C_PANAMA", "W_PANAMA_PAC"], ["W_PANAMA_PAC", "W_PANAMA_PAC2"], ["W_PANAMA_PAC2", "W_PAC_E"], ["W_PAC_E", "W_PAC_C"], ["W_PAC_C", "W_PAC_W"], ["W_PAC_W", "W_PAC_DL"], ["W_PAC_DL", "W_PAC_NW"], ["W_PAC_NW", "W_PAC_J"], ["W_PAC_J", "P_CHIBA"],
];

/** Chokepoint parameters: transit delay when restricted, and the stylised shocks when the status changes. */
export interface ChokepointSpec { id: string; name: string; node: string; restrictedDelayDays: Stylised<number>; warRiskUsdPerBbl: Stylised<number>; freightShock: Stylised<number>; ewShock: Stylised<number>; canal: boolean; what: string }
export const CHOKEPOINT_SPECS: Record<string, ChokepointSpec> = Object.fromEntries(CHOKEPOINTS.map((c) => [c.id, {
  id: c.id, name: c.name, node: `C_${c.id === "BOSPHORUS" ? "BOSPHORUS" : c.id}`,
  restrictedDelayDays: S(c.id === "SUEZ" || c.id === "PANAMA" ? 4 : 3, "days a transit waits when the passage is restricted (stylised)"),
  warRiskUsdPerBbl: S(c.id === "BAB_EL_MANDEB" || c.id === "HORMUZ" ? 0.6 : 0.3, "additional war-risk premium per barrel to transit a restricted passage (stylised)"),
  freightShock: S(c.id === "HORMUZ" ? 0.5 : c.id === "BAB_EL_MANDEB" || c.id === "SUEZ" ? 0.3 : c.id === "MALACCA" ? 0.3 : 0.1, "relative rise in the freight index when the passage shuts (stylised)"),
  ewShock: S(c.id === "HORMUZ" ? 2.0 : c.id === "BAB_EL_MANDEB" || c.id === "SUEZ" ? 0.8 : 0.2, "$/bbl rise in Brent minus Dubai when the passage shuts (stylised)"),
  canal: c.id === "SUEZ" || c.id === "PANAMA",
  what: `about ${Math.round(c.shareOfSeaborneOil.value * 100)}% of seaborne crude passes here (stylised share)`,
}]));

/** Physical grades on a quality grid. Differentials are base values versus the grade's benchmark, stylised. */
export interface GradeSpec { id: Grade; name: string; api: number; sulphur: number; benchmark: Basis; baseDiff: Stylised<number>; loadPorts: string[]; cargoKb: number; cls: VesselClass; naturalMarket: string }
export const GRADES: Record<Grade, GradeSpec> = {
  ARAB_LIGHT: { id: "ARAB_LIGHT", name: "Arab Light", api: 33, sulphur: 1.8, benchmark: "DUBAI", baseDiff: S(1.2, "a medium sour grade priced at a premium to Dubai, stylised"), loadPorts: ["RAS_TANURA"], cargoKb: 2000, cls: "VLCC", naturalMarket: "NINGBO" },
  BASRAH_MEDIUM: { id: "BASRAH_MEDIUM", name: "Basrah Medium", api: 29, sulphur: 2.9, benchmark: "DUBAI", baseDiff: S(-1.5, "heavier and sourer than Arab Light, stylised"), loadPorts: ["BASRAH"], cargoKb: 2000, cls: "VLCC", naturalMarket: "JAMNAGAR" },
  FORTIES: { id: "FORTIES", name: "Forties", api: 40, sulphur: 0.6, benchmark: "DATED", baseDiff: S(-0.25, "a light sweet North Sea grade a shade under Dated, stylised"), loadPorts: ["SULLOM_VOE"], cargoKb: 600, cls: "AFRAMAX", naturalMarket: "ROTTERDAM" },
  BONNY_LIGHT: { id: "BONNY_LIGHT", name: "Bonny Light", api: 35, sulphur: 0.15, benchmark: "DATED", baseDiff: S(0.6, "very sweet West African grade at a premium to Dated, stylised"), loadPorts: ["BONNY"], cargoKb: 1000, cls: "SUEZMAX", naturalMarket: "ROTTERDAM" },
  WTI_MIDLAND: { id: "WTI_MIDLAND", name: "WTI Midland", api: 42, sulphur: 0.3, benchmark: "WTI", baseDiff: S(0.6, "light sweet export grade at a premium to WTI Cushing, stylised"), loadPorts: ["CORPUS_CHRISTI", "HOUSTON"], cargoKb: 600, cls: "AFRAMAX", naturalMarket: "ROTTERDAM" },
  URALS: { id: "URALS", name: "Urals", api: 31, sulphur: 1.5, benchmark: "DATED", baseDiff: S(-2.5, "a medium sour grade at a discount to Dated, stylised; no sanctions modelled"), loadPorts: ["PRIMORSK", "NOVOROSSIYSK"], cargoKb: 600, cls: "AFRAMAX", naturalMarket: "JAMNAGAR" },
  ES_SIDER: { id: "ES_SIDER", name: "Es Sider", api: 37, sulphur: 0.4, benchmark: "DATED", baseDiff: S(-0.6, "a light sweet Med grade, stylised"), loadPorts: ["ES_SIDER"], cargoKb: 1000, cls: "SUEZMAX", naturalMarket: "ROTTERDAM" },
};
export const QUALITY_GRID = {
  usdPerApi: S(0.12, "$/bbl per degree API around 38 (stylised quality grid)"),
  usdPerSulphurPct: S(2.0, "$/bbl per percentage point of sulphur around 0.5% (stylised); tightens when fuel oil weakens"),
  claimUsdPerBbl: S(0.35, "a typical off-spec sulphur claim per barrel, stylised"),
};

/** The named counterparties (section 4). Ratings move with events; memory of a dispute arrives in milestone 3. */
export type CpType = "producer" | "refiner" | "trader" | "shipowner" | "bank" | "inspector";
export interface CounterpartySpec { id: string; name: string; type: CpType; rating: string; profile: string; diffEdge: number; lateDays: number; flaky: number; region: string; grades?: Grade[]; ports?: string[] }
export const COUNTERPARTIES: Record<string, CounterpartySpec> = {
  GULF_NATIONAL: { id: "GULF_NATIONAL", name: "Gulf National Oil", type: "producer", rating: "AA", profile: "national producer; term cargoes, firm differentials", diffEdge: 0.1, lateDays: 0, flaky: 0, region: "GULF", grades: ["ARAB_LIGHT", "BASRAH_MEDIUM"], ports: ["RAS_TANURA", "BASRAH"] },
  NORTHSEA_MAJOR: { id: "NORTHSEA_MAJOR", name: "Northsea Major Energy", type: "producer", rating: "A", profile: "major; equity cargoes, quotes near fair", diffEdge: 0.05, lateDays: 0, flaky: 0, region: "NSEA", grades: ["FORTIES"], ports: ["SULLOM_VOE"] },
  DELTA_INDEPENDENT: { id: "DELTA_INDEPENDENT", name: "Delta Independent Resources", type: "producer", rating: "BB", profile: "independent; needs cash, sometimes cheap, sometimes late", diffEdge: -0.2, lateDays: 2, flaky: 0.1, region: "WAF", grades: ["BONNY_LIGHT", "ES_SIDER"], ports: ["BONNY", "ES_SIDER"] },
  RHINE_REFINING: { id: "RHINE_REFINING", name: "Rhine Refining", type: "refiner", rating: "A", profile: "European refiner; bids CIF Rotterdam on Dated", diffEdge: 0.05, lateDays: 0, flaky: 0, region: "NSEA", ports: ["ROTTERDAM"] },
  EASTERN_PACIFIC: { id: "EASTERN_PACIFIC", name: "Eastern Pacific Refining", type: "refiner", rating: "A", profile: "Asian refiner; bids DES Ningbo or Jamnagar on Dubai", diffEdge: 0.1, lateDays: 0, flaky: 0, region: "ASIA", ports: ["NINGBO", "CHIBA", "JAMNAGAR"] },
  GULF_COAST_REFINING: { id: "GULF_COAST_REFINING", name: "Gulf Coast Refining", type: "refiner", rating: "BBB", profile: "US Gulf refiner; bids on WTI", diffEdge: 0.05, lateDays: 0, flaky: 0, region: "USGC", ports: ["HOUSTON", "ST_JAMES"] },
  ADRIATIC_SMALL: { id: "ADRIATIC_SMALL", name: "Adriatic Smallworks", type: "refiner", rating: "B", profile: "a small refiner that pays late", diffEdge: 0.3, lateDays: 12, flaky: 0.2, region: "MED", ports: ["ROTTERDAM"] },
  VANTAGE: { id: "VANTAGE", name: "Vantage Commodities", type: "trader", rating: "BB", profile: "aggressive trader; the cheapest offer on the screen, for a reason", diffEdge: -0.4, lateDays: 1, flaky: 0.3, region: "GLOBAL" },
  STELLAR: { id: "STELLAR", name: "Stellar Trading", type: "trader", rating: "A", profile: "reliable trader; fair prices, no surprises", diffEdge: 0.05, lateDays: 0, flaky: 0, region: "GLOBAL" },
  MERIDIAN_TRADERS: { id: "MERIDIAN_TRADERS", name: "Meridian Energy Traders", type: "trader", rating: "BBB", profile: "mid-sized trader; disappears in level 11", diffEdge: 0, lateDays: 0, flaky: 0.1, region: "GLOBAL" },
  HALVORSEN: { id: "HALVORSEN", name: "Halvorsen Tankers", type: "shipowner", rating: "A", profile: "reliable owner; modern ships, firm hire", diffEdge: 0.06, lateDays: 0, flaky: 0, region: "NSEA" },
  PONTOS: { id: "PONTOS", name: "Pontos Shipping", type: "shipowner", rating: "BBB", profile: "cheap hire, older ships, a day slower", diffEdge: -0.08, lateDays: 1, flaky: 0.15, region: "MED" },
  TIDEWATER: { id: "TIDEWATER", name: "Tidewater Crude Carriers", type: "shipowner", rating: "A", profile: "big fleet, market hire", diffEdge: 0, lateDays: 0, flaky: 0.05, region: "GULF" },
  NORDBANK: { id: "NORDBANK", name: "Nordbank", type: "bank", rating: "AA", profile: "the house bank: the line and letters of credit", diffEdge: 0, lateDays: 0, flaky: 0, region: "NSEA" },
  CRESCENT_BANK: { id: "CRESCENT_BANK", name: "Crescent Bank", type: "bank", rating: "A", profile: "a second bank; tighter covenants", diffEdge: 0, lateDays: 0, flaky: 0, region: "GULF" },
  VERITAS: { id: "VERITAS", name: "Veritas Marine Surveys", type: "inspector", rating: "A", profile: "the independent inspector; quality and quantity at load and discharge", diffEdge: 0, lateDays: 0, flaky: 0, region: "GLOBAL" },
};

/** The named fleet, placed at ports at the start of every level. */
export interface VesselSpec { id: string; name: string; cls: VesselClass; owner: string; port: string; age: number }
export const FLEET: VesselSpec[] = [
  { id: "V01", name: "Nordlys", cls: "AFRAMAX", owner: "HALVORSEN", port: "ROTTERDAM", age: 6 },
  { id: "V02", name: "Skarv", cls: "AFRAMAX", owner: "HALVORSEN", port: "SULLOM_VOE", age: 9 },
  { id: "V03", name: "Aegean Pride", cls: "AFRAMAX", owner: "PONTOS", port: "ROTTERDAM", age: 17 },
  { id: "V04", name: "Thalassa", cls: "SUEZMAX", owner: "PONTOS", port: "ES_SIDER", age: 15 },
  { id: "V05", name: "Lofoten Spirit", cls: "SUEZMAX", owner: "HALVORSEN", port: "ROTTERDAM", age: 5 },
  { id: "V06", name: "Tidewater Resolve", cls: "SUEZMAX", owner: "TIDEWATER", port: "BONNY", age: 8 },
  { id: "V07", name: "Tidewater Horizon", cls: "VLCC", owner: "TIDEWATER", port: "FUJAIRAH", age: 7 },
  { id: "V08", name: "Tidewater Meridian", cls: "VLCC", owner: "TIDEWATER", port: "RAS_TANURA", age: 12 },
  { id: "V09", name: "Pontos Giant", cls: "VLCC", owner: "PONTOS", port: "SINGAPORE", age: 19 },
  { id: "V10", name: "Halvorsen Titan", cls: "VLCC", owner: "HALVORSEN", port: "ROTTERDAM", age: 4 },
  { id: "V11", name: "Gulf Runner", cls: "MR", owner: "TIDEWATER", port: "HOUSTON", age: 10 },
  { id: "V12", name: "Channel Star", cls: "MR", owner: "PONTOS", port: "ROTTERDAM", age: 14 },
  { id: "V13", name: "Atlantic LR", cls: "LR2", owner: "HALVORSEN", port: "HOUSTON", age: 7 },
  { id: "V14", name: "Polar Gas", cls: "LNGC", owner: "HALVORSEN", port: "SABINE_PASS", age: 3 },
  { id: "V15", name: "Methane Tide", cls: "LNGC", owner: "TIDEWATER", port: "SABINE_PASS", age: 8 },
  { id: "V16", name: "Tidewater Gulf", cls: "AFRAMAX", owner: "TIDEWATER", port: "HOUSTON", age: 9 },
];

export const SHIPPING = {
  laytimeHours: S(36, "laytime allowed at each of load and discharge; beyond it the charterer pays demurrage (stylised)"),
  loadHours: S(30, "hours to load a cargo once alongside (stylised)"),
  dischargeHours: S(24, "hours to discharge once alongside (stylised); with six hours to berth that leaves six hours of laytime slack"),
  portDaysInCharter: S(4, "port days priced into a voyage charter: two at each end (stylised)"),
  charterMarginShare: S(0.08, "an owner's margin over bare hire on a voyage charter (stylised)"),
  insurancePerBbl: S(0.05, "marine cargo insurance per barrel (stylised)"),
  slowSteamMin: S(0.7, "the slowest a ship will go, as a share of service speed (stylised)"),
  anchorHireShare: S(1.0, "a ship waiting at anchor costs its full hire (stylised)"),
  paymentDaysAfterWindow: S(5, "an invoice is paid five days after a pricing window completes (stylised)"),
};

/** Voyage days from section 14 of the prompt (laden at 12.5 kn), kept as the reference the sea graph is tested against. */
export const REFERENCE_VOYAGE_DAYS: { from: string; to: string; via?: string; days: Stylised<number> }[] = [
  { from: "RAS_TANURA", to: "ROTTERDAM", via: "SUEZ", days: S(20, "section 14") },
  { from: "RAS_TANURA", to: "ROTTERDAM", via: "CAPE", days: S(34, "section 14") },
  { from: "RAS_TANURA", to: "NINGBO", days: S(22, "section 14") },
  { from: "HOUSTON", to: "ROTTERDAM", days: S(15, "section 14") },
  { from: "SULLOM_VOE", to: "ROTTERDAM", days: S(2, "section 14") },
  { from: "BONNY", to: "ROTTERDAM", days: S(14, "section 14") },
  { from: "NOVOROSSIYSK", to: "JAMNAGAR", via: "SUEZ", days: S(16, "section 14") },
  { from: "SABINE_PASS", to: "GATE", days: S(13, "section 14") },
];
