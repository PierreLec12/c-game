/**
 * Vessels, routes, voyages, chokepoints (section 4). The sea graph in world_data.ts is a set of ports, waypoints
 * and chokepoints joined by great-circle edges; a route is the shortest path with closed chokepoints removed.
 * Days at sea are distance over speed (12.5 knots laden, 13.5 ballast, times a slow-steaming factor).
 */
import { CHOKEPOINT_SPECS, COUNTERPARTIES, FLEET, PORTS, SEA_EDGES, SEA_NODES, SHIPPING, VESSEL_CLASSES, classAtMost, type VesselClass } from "./world_data";
import type { Cargo, State, Vessel, Voyage, VoyageLeg } from "./types";

const R_NM = 3440.065; // earth radius in nautical miles
export function greatCircleNm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const NODE_BY_ID: Record<string, { id: string; lon: number; lat: number; chokepoint?: string }> = Object.fromEntries(SEA_NODES.map((n) => [n.id, n]));
const ADJ: Record<string, { to: string; nm: number }[]> = {};
for (const [a, b] of SEA_EDGES) {
  const na = NODE_BY_ID[a], nb = NODE_BY_ID[b];
  if (!na || !nb) throw new Error(`sea edge references an unknown node: ${a}-${b}`);
  const nm = greatCircleNm(na.lon, na.lat, nb.lon, nb.lat);
  (ADJ[a] ??= []).push({ to: b, nm });
  (ADJ[b] ??= []).push({ to: a, nm });
}
export const SEA_ADJACENCY = ADJ;

/** Shortest sea path between two nodes avoiding the blocked chokepoint nodes. */
export function shortestPath(from: string, to: string, blocked: ReadonlySet<string> = new Set()): { path: string[]; nm: number } | null {
  if (from === to) return { path: [from], nm: 0 };
  const dist: Record<string, number> = { [from]: 0 };
  const prev: Record<string, string> = {};
  const done = new Set<string>();
  const queue: string[] = [from];
  while (queue.length) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (dist[queue[i]] < dist[queue[bi]]) bi = i;
    const u = queue.splice(bi, 1)[0];
    if (done.has(u)) continue;
    done.add(u);
    if (u === to) break;
    for (const e of ADJ[u] ?? []) {
      if (blocked.has(e.to) && e.to !== to) continue;
      const d = dist[u] + e.nm;
      if (dist[e.to] === undefined || d < dist[e.to]) { dist[e.to] = d; prev[e.to] = u; queue.push(e.to); }
    }
  }
  if (dist[to] === undefined) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev[path[0]]);
  return { path, nm: dist[to] };
}

export function blockedNodes(state: State): Set<string> {
  const out = new Set<string>();
  for (const c of Object.values(state.chokepoints)) if (c.status === "closed") out.add(CHOKEPOINT_SPECS[c.id].node);
  return out;
}

export function chokepointsOnPath(path: string[]): string[] {
  return path.map((n) => NODE_BY_ID[n]?.chokepoint).filter((c): c is string => !!c && !!CHOKEPOINT_SPECS[c]);
}

/** Position along a path after `nmDone` nautical miles. */
export function positionAlong(path: string[], nmDone: number): { lon: number; lat: number; nodeIndex: number } {
  let left = Math.max(0, nmDone);
  for (let i = 0; i + 1 < path.length; i++) {
    const a = NODE_BY_ID[path[i]], b = NODE_BY_ID[path[i + 1]];
    const seg = greatCircleNm(a.lon, a.lat, b.lon, b.lat);
    if (left <= seg + 1e-6 || i + 2 === path.length) {
      const f = seg > 0 ? Math.min(1, left / seg) : 1;
      // linear interpolation in lon/lat is fine for drawing at this scale; wrap the antimeridian
      let dLon = b.lon - a.lon;
      if (dLon > 180) dLon -= 360;
      if (dLon < -180) dLon += 360;
      let lon = a.lon + f * dLon;
      if (lon > 180) lon -= 360;
      if (lon < -180) lon += 360;
      return { lon, lat: a.lat + f * (b.lat - a.lat), nodeIndex: i };
    }
    left -= seg;
  }
  const last = NODE_BY_ID[path[path.length - 1]];
  return { lon: last.lon, lat: last.lat, nodeIndex: path.length - 1 };
}

export function pathNm(path: string[]): number {
  let nm = 0;
  for (let i = 0; i + 1 < path.length; i++) { const a = NODE_BY_ID[path[i]], b = NODE_BY_ID[path[i + 1]]; nm += greatCircleNm(a.lon, a.lat, b.lon, b.lat); }
  return nm;
}

export const speedKn = (cls: VesselClass, laden: boolean, factor: number): number => (laden ? VESSEL_CLASSES[cls].speedLaden : VESSEL_CLASSES[cls].speedBallast) * factor;
export const daysFor = (nm: number, kn: number): number => nm / (kn * 24);

export function initFleet(): Vessel[] {
  return FLEET.map((v) => {
    const port = PORTS[v.port];
    const node = NODE_BY_ID[port.node];
    return { id: v.id, name: v.name, cls: v.cls, owner: v.owner, status: "available", lon: node.lon, lat: node.lat, node: port.node, atPort: v.port, voyageId: null, age: v.age, speedFactor: v.age > 15 ? 0.95 : 1 };
  });
}

export function hireNow(state: State, cls: VesselClass): number {
  return VESSEL_CLASSES[cls].hireUsdPerDay.value * state.factors.freightIndex;
}

export interface CharterQuote { vesselId: string; vessel: string; owner: string; cls: VesselClass; hireUsdPerDay: number; ballastDays: number; ladenDays: number; portDays: number; lumpUsd: number; usdPerBbl: number; etaLoadDay: number; fits: boolean; why: string; path: string[] }

/** Every available vessel that can carry the cargo, with the owner's voyage-charter quote. */
export function charterQuotes(state: State, cargo: Cargo): CharterQuote[] {
  const load = PORTS[cargo.loadPort];
  const disc = PORTS[cargo.dischargePort];
  const blocked = blockedNodes(state);
  const out: CharterQuote[] = [];
  for (const v of state.vessels) {
    if (v.status !== "available") continue;
    const cap = VESSEL_CLASSES[v.cls].cargoKb.value * 1000;
    const lng = cargo.grade === "LNG";
    const fitsSize = lng ? v.cls === "LNGC" : cap >= cargo.bbl && cap <= cargo.bbl * 2.5 && v.cls !== "LNGC";
    const fitsDraft = classAtMost(v.cls, load.maxClass) && classAtMost(v.cls, disc.maxClass) && (lng || v.cls !== "LNGC");
    const ballast = shortestPath(v.node, load.node, blocked);
    const laden = shortestPath(load.node, disc.node, blocked);
    if (!ballast || !laden) continue;
    const ballastDays = daysFor(ballast.nm, speedKn(v.cls, false, v.speedFactor));
    const ladenDays = daysFor(laden.nm, speedKn(v.cls, true, v.speedFactor));
    const owner = COUNTERPARTIES[v.owner];
    const hire = hireNow(state, v.cls) * (1 + owner.diffEdge);
    const portDays = SHIPPING.portDaysInCharter.value;
    const lump = hire * (1 + SHIPPING.charterMarginShare.value) * (ballastDays + ladenDays + portDays);
    const etaLoadDay = Math.ceil((state.tick + ballastDays * 24) / 24);
    const fits = fitsSize && fitsDraft;
    const why = `${owner.name}: hire $${Math.round(hire).toLocaleString()}/day (base ${VESSEL_CLASSES[v.cls].name} hire x freight index ${state.factors.freightIndex.toFixed(2)} x owner ${owner.diffEdge >= 0 ? "+" : ""}${Math.round(owner.diffEdge * 100)}%), ${ballastDays.toFixed(1)} days ballast + ${ladenDays.toFixed(1)} laden + ${portDays} port days, plus an ${Math.round(SHIPPING.charterMarginShare.value * 100)}% margin = $${Math.round(lump).toLocaleString()} lump sum, $${(lump / cargo.bbl).toFixed(lng ? 3 : 2)}/${lng ? "MMBtu" : "bbl"} (stylised).${fits ? "" : !fitsSize ? (lng ? " Only an LNG carrier can carry LNG." : " Wrong size for this cargo.") : " Draft: this class cannot berth at both ports."}`;
    out.push({ vesselId: v.id, vessel: v.name, owner: owner.name, cls: v.cls, hireUsdPerDay: hire, ballastDays, ladenDays, portDays, lumpUsd: lump, usdPerBbl: lump / cargo.bbl, etaLoadDay, fits, why, path: laden.path });
  }
  return out.sort((a, b) => Number(b.fits) - Number(a.fits) || a.lumpUsd - b.lumpUsd);
}

/** The market freight for a cargo before a ship is fixed: the cheapest fitting quote, or the class's base economics. */
export function expectedFreightUsd(state: State, cargo: Cargo): number {
  const quotes = charterQuotes(state, cargo).filter((q) => q.fits);
  if (quotes.length) return quotes[0].lumpUsd;
  const load = PORTS[cargo.loadPort], disc = PORTS[cargo.dischargePort];
  const laden = shortestPath(load.node, disc.node, blockedNodes(state));
  const cls = cargo.grade === "LNG" ? "LNGC" : (["AFRAMAX", "SUEZMAX", "VLCC"] as VesselClass[]).find((c) => VESSEL_CLASSES[c].cargoKb.value * 1000 >= cargo.bbl) ?? "VLCC";
  const days = laden ? daysFor(laden.nm, speedKn(cls, true, 1)) : 20;
  return hireNow(state, cls) * (1 + SHIPPING.charterMarginShare.value) * (days + SHIPPING.portDaysInCharter.value + 3);
}

/** Plan the legs of a voyage for a fixed vessel: ballast to the load port, then laden to the discharge port. */
export function planLegs(state: State, vessel: Vessel, cargo: Cargo): VoyageLeg[] | null {
  const blocked = blockedNodes(state);
  const load = PORTS[cargo.loadPort], disc = PORTS[cargo.dischargePort];
  const ballast = shortestPath(vessel.node, load.node, blocked);
  const laden = shortestPath(load.node, disc.node, blocked);
  if (!ballast || !laden) return null;
  return [
    { kind: "ballast", from: vessel.node, to: load.node, path: ballast.path, nm: ballast.nm, depTick: state.tick, arrTick: null },
    { kind: "laden", from: load.node, to: disc.node, path: laden.path, nm: laden.nm, depTick: null, arrTick: null },
  ];
}

/** Re-path the laden leg from the ship's current position, avoiding `avoid` chokepoint nodes as well as closed ones. */
export function repathFromHere(state: State, voyage: Voyage, avoid: string[] = []): { leg: VoyageLeg; extraNm: number; nmDone: number } | null {
  const leg = voyage.legs[voyage.legIndex];
  const pos = positionAlong(leg.path, voyage.nmDone);
  const blocked = new Set([...blockedNodes(state), ...avoid]);
  let startIdx = Math.min(pos.nodeIndex + 1, leg.path.length - 1);
  // if the next node is the passage itself, turn back to the node before it
  if (blocked.has(leg.path[startIdx]) && startIdx > 0) startIdx = pos.nodeIndex;
  const fromNode = leg.path[startIdx];
  const rest = shortestPath(fromNode, leg.to, blocked);
  if (!rest) return null;
  const doneNodes = leg.path.slice(0, startIdx);
  const newPath = [...doneNodes, ...rest.path];
  const newNm = pathNm(newPath);
  const nmDone = pathNm(newPath.slice(0, startIdx + 1));
  const remainingBefore = leg.nm - voyage.nmDone;
  const remainingAfter = newNm - nmDone;
  return { leg: { ...leg, path: newPath, nm: newNm }, extraNm: remainingAfter - remainingBefore, nmDone };
}

export function voyageVessel(state: State, v: Voyage): Vessel { return state.vessels.find((x) => x.id === v.vesselId)!; }
export function voyageCargo(state: State, v: Voyage): Cargo { return state.cargoes.find((x) => x.id === v.cargoId)!; }

/** The ship's current position. */
export function voyagePosition(voyage: Voyage): { lon: number; lat: number } {
  const leg = voyage.legs[voyage.legIndex];
  if (!leg) { const n = NODE_BY_ID[voyage.legs[voyage.legs.length - 1].to]; return { lon: n.lon, lat: n.lat }; }
  return positionAlong(leg.path, voyage.nmDone);
}

/** Remaining laden days at the current speed, and the ETA tick. */
export function etaTick(state: State, voyage: Voyage): number {
  const vessel = voyageVessel(state, voyage);
  let t = state.tick;
  for (let i = voyage.legIndex; i < voyage.legs.length; i++) {
    const leg = voyage.legs[i];
    const nmLeft = i === voyage.legIndex ? Math.max(0, leg.nm - voyage.nmDone) : leg.nm;
    t += daysFor(nmLeft, speedKn(vessel.cls, leg.kind === "laden", vessel.speedFactor * voyage.speedFactor)) * 24;
    if (leg.kind === "ballast") t += SHIPPING.loadHours.value + 6;
  }
  if (voyage.waitUntil && voyage.waitUntil > state.tick) t += voyage.waitUntil - state.tick;
  if (voyage.anchorUntil && voyage.anchorUntil > state.tick) t += voyage.anchorUntil - state.tick;
  return Math.ceil(t);
}

/** Days and cost of both ways through a restricted passage, for the callout and the bot. */
export function passageOptions(state: State, voyage: Voyage): { proceed: { extraDays: number; costUsd: number }; reroute: { extraDays: number; costUsd: number; via: string } | null } {
  const cargo = voyageCargo(state, voyage);
  const vessel = voyageVessel(state, voyage);
  const cp = voyage.blockedAt ? CHOKEPOINT_SPECS[voyage.blockedAt] : null;
  const proceedDays = cp ? cp.restrictedDelayDays.value : 0;
  const proceed = { extraDays: proceedDays, costUsd: (cp ? cp.warRiskUsdPerBbl.value * cargo.bbl : 0) + proceedDays * voyage.hireUsdPerDay * SHIPPING.anchorHireShare.value };
  const alt = cp ? repathFromHere(state, voyage, [cp.node]) : null;
  const reroute = alt ? { extraDays: daysFor(alt.extraNm, speedKn(vessel.cls, true, vessel.speedFactor * voyage.speedFactor)), costUsd: daysFor(alt.extraNm, speedKn(vessel.cls, true, vessel.speedFactor * voyage.speedFactor)) * voyage.hireUsdPerDay, via: alt.leg.path.includes("C_CAPE") ? "the Cape" : "another passage" } : null;
  return { proceed, reroute };
}
