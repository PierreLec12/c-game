/**
 * The voyage stepper: one tick of every ship. Ballast to the load port, wait for the laycan, load, sign the bill
 * of lading, sail, stop at a restricted chokepoint for an instruction, queue for a berth, discharge, release the
 * ship. Demurrage is laytime exceeded at the discharge port; freight and demurrage are paid at delivery.
 */
import { HOURS_PER_DAY, formatClock } from "./calendar";
import { ledger } from "./finance";
import { publishNews } from "./information";
import { CHOKEPOINT_SPECS, GRADES, PORTS, SHIPPING, VESSEL_CLASSES } from "./world_data";
import { NODE_BY_ID, etaTick, positionAlong, repathFromHere, speedKn, voyageCargo, voyageVessel, blockedNodes, daysFor, greatCircleNm, shortestPath, passageOptions } from "./shipping";
import { chargeCargo, onBillOfLading, onDischarged, remarkCargo, cancelCargo } from "./physical";
import { COUNTERPARTIES } from "./world_data";
import type { AttributionRow, EngineEvent, State, Voyage } from "./types";

const usd = (x: number) => (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString();

export function stepVoyages(state: State): { events: EngineEvent[]; rows: AttributionRow[] } {
  const events: EngineEvent[] = [];
  const rows: AttributionRow[] = [];
  for (const v of state.voyages) {
    if (v.status === "done") continue;
    const vessel = voyageVessel(state, v);
    const cargo = voyageCargo(state, v);
    const leg = v.legs[v.legIndex];
    const name = `${vessel.name} (${GRADES[cargo.grade].name} ${cargo.id})`;
    const advance = () => {
      const kn = speedKn(vessel.cls, leg.kind === "laden", vessel.speedFactor * v.speedFactor);
      const before = positionAlong(leg.path, v.nmDone).nodeIndex;
      v.nmDone = Math.min(leg.nm, v.nmDone + kn);
      const pos = positionAlong(leg.path, v.nmDone);
      vessel.lon = pos.lon; vessel.lat = pos.lat; vessel.atPort = null;
      v.trail.push([state.tick, pos.lon, pos.lat]);
      if (v.trail.length > 48) v.trail.shift();
      // chokepoints passed on this step
      for (let i = before + 1; i <= pos.nodeIndex; i++) {
        const cp = NODE_BY_ID[leg.path[i]]?.chokepoint;
        if (!cp || !CHOKEPOINT_SPECS[cp] || v.cleared.includes(cp)) continue;
        const st = state.chokepoints[cp];
        if (st && st.status === "restricted" && leg.kind === "laden") {
          // hold at the chokepoint node for an instruction
          let nmToNode = 0;
          for (let j = 0; j < i; j++) { const a = NODE_BY_ID[leg.path[j]], b = NODE_BY_ID[leg.path[j + 1]]; nmToNode += greatCircleNm(a.lon, a.lat, b.lon, b.lat); }
          v.nmDone = nmToNode;
          const p2 = positionAlong(leg.path, v.nmDone);
          vessel.lon = p2.lon; vessel.lat = p2.lat;
          v.status = "waiting_chokepoint";
          v.blockedAt = cp;
          events.push({ kind: "chokepoint", tick: state.tick, text: `${name} is holding at ${CHOKEPOINT_SPECS[cp].name}: the passage is restricted. Pay war risk and transit with a ${CHOKEPOINT_SPECS[cp].restrictedDelayDays.value}-day delay, or reroute.`, pause: true, data: { voyageId: v.id, cargoId: cargo.id, chokepoint: cp } });
          return;
        }
      }
    };
    switch (v.status) {
      case "ballast": {
        advance();
        if (v.nmDone >= leg.nm - 1e-6) {
          leg.arrTick = state.tick;
          vessel.node = leg.to; vessel.atPort = cargo.loadPort;
          const laycanStart = cargo.laycan[0] * HOURS_PER_DAY;
          if (state.tick < laycanStart) { v.status = "waiting_laycan"; events.push({ kind: "voyage", tick: state.tick, text: `${name} arrived at ${PORTS[cargo.loadPort].name} ahead of the laycan; waiting to load from day ${cargo.laycan[0]}.`, data: { voyageId: v.id } }); }
          else beginLoading(state, v, events, name);
        }
        break;
      }
      case "waiting_laycan": {
        if (state.tick >= cargo.laycan[0] * HOURS_PER_DAY) beginLoading(state, v, events, name);
        break;
      }
      case "loading": {
        if (v.loadEnd !== null && state.tick >= v.loadEnd) {
          onBillOfLading(state, cargo);
          vessel.status = "laden"; cargo.status = "laden";
          v.status = "laden"; v.legIndex = 1; v.nmDone = 0; v.legs[1].depTick = state.tick;
          v.eta = etaTick(state, v);
          rows.push(...remarkCargo(state, cargo, "bill of lading"));
          events.push({ kind: "voyage", tick: state.tick, text: `Bill of lading signed: ${name} loaded ${cargo.bbl.toLocaleString()} bbl at ${PORTS[cargo.loadPort].name}. The purchase prices over ${cargo.purchase.windowDays!.map((d) => `day ${d}`).join(", ")}. ETA ${PORTS[cargo.dischargePort].name} ${formatClock(state.startDay, v.eta)}.`, pause: true, data: { voyageId: v.id, cargoId: cargo.id } });
        }
        break;
      }
      case "laden": {
        advance();
        if (v.status === "laden" && v.nmDone >= leg.nm - 1e-6) arrive(state, v, events, name);
        break;
      }
      case "waiting_chokepoint": {
        if (v.waitUntil !== null && state.tick >= v.waitUntil) { v.status = "laden"; v.waitUntil = null; v.blockedAt = null; v.eta = etaTick(state, v); events.push({ kind: "voyage", tick: state.tick, text: `${name} cleared the passage and is under way again. ETA ${formatClock(state.startDay, v.eta)}.`, data: { voyageId: v.id } }); }
        break;
      }
      case "anchored": {
        if (v.anchorUntil !== null && state.tick >= v.anchorUntil) { v.anchorUntil = null; tenderNor(state, v, events, name); }
        break;
      }
      case "waiting_berth": {
        if (v.berthTick !== null && state.tick >= v.berthTick) { v.status = "discharging"; vessel.status = "discharging"; cargo.status = "discharging"; v.dischargeEnd = state.tick + SHIPPING.dischargeHours.value; events.push({ kind: "voyage", tick: state.tick, text: `${name} alongside at ${PORTS[cargo.dischargePort].name}; discharging.`, data: { voyageId: v.id } }); }
        break;
      }
      case "discharging": {
        if (v.dischargeEnd !== null && state.tick >= v.dischargeEnd) complete(state, v, events, rows, name);
        break;
      }
      default: break;
    }
  }
  return { events, rows };
}

function beginLoading(state: State, v: Voyage, events: EngineEvent[], name: string): void {
  const vessel = voyageVessel(state, v);
  const cargo = voyageCargo(state, v);
  if (cargo.requiresLc && !cargo.lcId) {
    state.pnl.attribution.push(...cancelCargo(state, cargo, cargo.purchase.counterparty, "no letter of credit at the laycan", true));
    events.push({ kind: "cargo", tick: state.tick, text: `${COUNTERPARTIES[cargo.purchase.counterparty].name} will not load ${name}: the letter of credit was never opened. The cargo is cancelled and the charter with it.`, pause: true, data: { cargoId: cargo.id } });
    return;
  }
  v.status = "loading"; vessel.status = "loading"; cargo.status = "loading";
  v.berthTick = state.tick;
  v.loadEnd = state.tick + SHIPPING.loadHours.value;
  events.push({ kind: "voyage", tick: state.tick, text: `${name} is loading at ${PORTS[cargo.loadPort].name}; B/L in ${SHIPPING.loadHours.value} hours.`, data: { voyageId: v.id } });
}

function arrive(state: State, v: Voyage, events: EngineEvent[], name: string): void {
  const vessel = voyageVessel(state, v);
  const cargo = voyageCargo(state, v);
  const leg = v.legs[v.legIndex];
  leg.arrTick = state.tick;
  vessel.node = leg.to; vessel.atPort = cargo.dischargePort;
  if (v.anchorUntil !== null && v.anchorUntil > state.tick) {
    v.status = "anchored"; vessel.status = "waiting";
    events.push({ kind: "arrival", tick: state.tick, text: `${name} is at anchor off ${PORTS[cargo.dischargePort].name} as instructed, until ${formatClock(state.startDay, v.anchorUntil)}: storage on water at ${usd(v.hireUsdPerDay)} a day.`, data: { voyageId: v.id }, pause: true });
    return;
  }
  tenderNor(state, v, events, name);
}

function tenderNor(state: State, v: Voyage, events: EngineEvent[], name: string): void {
  const vessel = voyageVessel(state, v);
  const cargo = voyageCargo(state, v);
  v.norTick = state.tick;
  const congestion = state.portCongestion[cargo.dischargePort] ?? 0;
  const windowStart = cargo.dischargeWindow ? cargo.dischargeWindow[0] * HOURS_PER_DAY : state.tick;
  v.berthTick = Math.max(state.tick, congestion, windowStart) + 6;
  v.status = "waiting_berth"; vessel.status = "waiting";
  const wait = v.berthTick - state.tick;
  events.push({ kind: "arrival", tick: state.tick, text: `${name} tendered notice of readiness at ${PORTS[cargo.dischargePort].name}. Berth in ${wait} hours${congestion > state.tick ? " (the port is congested)" : windowStart > state.tick ? " (ahead of the discharge window)" : ""}.`, data: { voyageId: v.id, cargoId: cargo.id }, pause: wait > 24 });
}

function complete(state: State, v: Voyage, events: EngineEvent[], rows: AttributionRow[], name: string): void {
  const vessel = voyageVessel(state, v);
  const cargo = voyageCargo(state, v);
  onDischarged(state, cargo);
  v.status = "done";
  vessel.status = "available"; vessel.voyageId = null; vessel.atPort = cargo.dischargePort;
  // laytime: from notice of readiness (or the discharge window start, if later) until discharge completes, less the allowance
  const windowStart = cargo.dischargeWindow ? cargo.dischargeWindow[0] * HOURS_PER_DAY : v.norTick!;
  const used = state.tick - Math.max(v.norTick!, windowStart);
  const over = Math.max(0, used - SHIPPING.laytimeHours.value);
  if (over > 0) {
    const dem = (over / 24) * v.hireUsdPerDay;
    rows.push(chargeCargo(state, cargo, "demurrage", dem, `${name}: ${over} hours over the ${SHIPPING.laytimeHours.value}-hour laytime at ${PORTS[cargo.dischargePort].name}: demurrage ${usd(dem)} at ${usd(v.hireUsdPerDay)} a day.`));
    events.push({ kind: "claim", tick: state.tick, text: `Demurrage: ${name} used ${used} hours against ${SHIPPING.laytimeHours.value} allowed at ${PORTS[cargo.dischargePort].name}: ${usd(dem)}.`, data: { cargoId: cargo.id, hours: over }, pause: true });
  }
  // freight and demurrage are paid at delivery
  ledger(state, "other", -v.lumpUsd, `Freight paid: ${vessel.name} voyage charter for ${GRADES[cargo.grade].name} ${cargo.id}`);
  cargo.freight.paidTick = state.tick;
  if (cargo.demurrageUsd > 0) { ledger(state, "other", -cargo.demurrageUsd, `Demurrage paid on ${GRADES[cargo.grade].name} ${cargo.id}`); cargo.demurragePaidTick = state.tick; }
  if (cargo.warRiskUsd > 0) { ledger(state, "other", -cargo.warRiskUsd, `War-risk premium paid on ${GRADES[cargo.grade].name} ${cargo.id}`); cargo.warRiskUsd = 0; cargo.extraCostsBase -= 0; }
  rows.push(...remarkCargo(state, cargo, "delivery"));
  events.push({ kind: "arrival", tick: state.tick, text: `${name} discharged ${cargo.bbl.toLocaleString()} bbl at ${PORTS[cargo.dischargePort].name}. ${cargo.sale ? `The sale prices over ${cargo.sale.windowDays ? cargo.sale.windowDays.map((d) => `day ${d}`).join(", ") : "its window"}.` : "The cargo is unsold: it sits in the receiver's tank at the market price."} Freight ${usd(v.lumpUsd)} paid.`, pause: true, data: { voyageId: v.id, cargoId: cargo.id } });
  publishNews(state, { source: "wire", headline: `${vessel.name} discharged at ${PORTS[cargo.dischargePort].name}`, body: `${cargo.bbl.toLocaleString()} bbl of ${GRADES[cargo.grade].name}. The ship is released and available at ${PORTS[cargo.dischargePort].name}.` });
}

/** A chokepoint closed: every laden voyage still due to pass it is re-routed from where it is. */
export function rerouteAround(state: State, chokepointId: string): EngineEvent[] {
  const events: EngineEvent[] = [];
  const node = CHOKEPOINT_SPECS[chokepointId].node;
  for (const v of state.voyages) {
    if (v.status !== "laden" && v.status !== "waiting_chokepoint") continue;
    const leg = v.legs[v.legIndex];
    const pos = positionAlong(leg.path, v.nmDone);
    const ahead = leg.path.slice(pos.nodeIndex + 1);
    if (!ahead.includes(node)) continue;
    const alt = repathFromHere(state, v, [node]);
    const vessel = voyageVessel(state, v);
    const cargo = voyageCargo(state, v);
    if (!alt) { events.push({ kind: "chokepoint", tick: state.tick, text: `${vessel.name} has no way round ${CHOKEPOINT_SPECS[chokepointId].name}; holding.`, pause: true }); v.status = "waiting_chokepoint"; v.blockedAt = chokepointId; continue; }
    const extraDays = daysFor(alt.extraNm, speedKn(vessel.cls, true, vessel.speedFactor * v.speedFactor));
    v.legs[v.legIndex] = alt.leg; v.nmDone = alt.nmDone;
    v.status = "laden"; v.blockedAt = null; v.waitUntil = null;
    v.detour = `${CHOKEPOINT_SPECS[chokepointId].name} closed: rerouted via ${alt.leg.path.includes("C_CAPE") ? "the Cape" : "another passage"}, +${extraDays.toFixed(1)} days, +${usd(extraDays * v.hireUsdPerDay)} of hire`;
    v.eta = etaTick(state, v);
    events.push({ kind: "chokepoint", tick: state.tick, text: `${vessel.name} (${GRADES[cargo.grade].name} ${cargo.id}): ${v.detour}. New ETA ${formatClock(state.startDay, v.eta)}.`, pause: true, data: { voyageId: v.id, cargoId: cargo.id } });
  }
  return events;
}

/** The player's instruction at a restricted passage. */
export function passageDecision(state: State, v: Voyage, choice: "proceed" | "reroute"): { events: EngineEvent[]; rows: AttributionRow[] } {
  const events: EngineEvent[] = [];
  const rows: AttributionRow[] = [];
  const cp = CHOKEPOINT_SPECS[v.blockedAt!];
  const vessel = voyageVessel(state, v);
  const cargo = voyageCargo(state, v);
  const opts = passageOptions(state, v);
  v.decision = { chokepoint: cp.id, choice, proceedUsd: opts.proceed.costUsd, rerouteUsd: opts.reroute ? opts.reroute.costUsd : Infinity, tick: state.tick };
  if (choice === "proceed") {
    const premium = cp.warRiskUsdPerBbl.value * cargo.bbl;
    rows.push(chargeCargo(state, cargo, "freight", premium, `${vessel.name}: war-risk premium ${usd(premium)} (${cp.warRiskUsdPerBbl.value.toFixed(2)} $/bbl, stylised) to transit ${cp.name} while restricted.`));
    v.waitUntil = state.tick + cp.restrictedDelayDays.value * HOURS_PER_DAY;
    v.cleared.push(cp.id);
    v.eta = etaTick(state, v);
    events.push({ kind: "voyage", tick: state.tick, text: `${vessel.name} will transit ${cp.name} after a ${cp.restrictedDelayDays.value}-day convoy wait; war risk ${usd(premium)} charged to the cargo. ETA ${formatClock(state.startDay, v.eta)}.`, data: { voyageId: v.id } });
  } else {
    const alt = repathFromHere(state, v, [cp.node]);
    if (!alt) { events.push({ kind: "voyage", tick: state.tick, text: `No alternative route from here.` }); return { events, rows }; }
    const extraDays = daysFor(alt.extraNm, speedKn(vessel.cls, true, vessel.speedFactor * v.speedFactor));
    v.legs[v.legIndex] = alt.leg; v.nmDone = alt.nmDone;
    v.status = "laden"; v.blockedAt = null; v.waitUntil = null;
    const extraHire = extraDays * v.hireUsdPerDay;
    rows.push(chargeCargo(state, cargo, "freight", extraHire, `${vessel.name}: detour via ${alt.leg.path.includes("C_CAPE") ? "the Cape" : "another passage"} around ${cp.name}: +${extraDays.toFixed(1)} days of hire, ${usd(extraHire)}.`));
    v.detour = `rerouted around ${cp.name}: +${extraDays.toFixed(1)} days`;
    v.eta = etaTick(state, v);
    events.push({ kind: "voyage", tick: state.tick, text: `${vessel.name} rerouted around ${cp.name}: +${extraDays.toFixed(1)} days and ${usd(extraHire)} of hire. ETA ${formatClock(state.startDay, v.eta)}.`, data: { voyageId: v.id } });
  }
  return { events, rows };
}

/** Divert a laden ship to a new discharge port (a resale afloat). */
export function divert(state: State, v: Voyage, newPort: string): EngineEvent[] {
  const events: EngineEvent[] = [];
  const cargo = voyageCargo(state, v);
  const vessel = voyageVessel(state, v);
  const leg = v.legs[v.legIndex];
  if (leg.kind !== "laden") {
    const p = shortestPath(v.legs[1].from, PORTS[newPort].node, blockedNodes(state));
    if (!p) return [{ kind: "voyage", tick: state.tick, text: `No sea route from ${PORTS[cargo.loadPort].name} to ${PORTS[newPort].name}.` }];
    v.legs[1] = { ...v.legs[1], to: PORTS[newPort].node, path: p.path, nm: p.nm };
    cargo.dischargePort = newPort;
    v.eta = etaTick(state, v);
    return [{ kind: "voyage", tick: state.tick, text: `${vessel.name} will discharge at ${PORTS[newPort].name}. ETA ${formatClock(state.startDay, v.eta)}.`, data: { voyageId: v.id } }];
  }
  const pos = positionAlong(leg.path, v.nmDone);
  const fromNode = leg.path[Math.min(pos.nodeIndex + 1, leg.path.length - 1)];
  const rest = shortestPath(fromNode, PORTS[newPort].node, blockedNodes(state));
  if (!rest) return [{ kind: "voyage", tick: state.tick, text: `No sea route from here to ${PORTS[newPort].name}.` }];
  const done = leg.path.slice(0, pos.nodeIndex + 1);
  const newPath = [...done, ...rest.path];
  let nm = 0;
  for (let i = 0; i + 1 < newPath.length; i++) { const a = NODE_BY_ID[newPath[i]], b = NODE_BY_ID[newPath[i + 1]]; nm += greatCircleNm(a.lon, a.lat, b.lon, b.lat); }
  v.legs[v.legIndex] = { ...leg, to: PORTS[newPort].node, path: newPath, nm };
  cargo.dischargePort = newPort;
  v.eta = etaTick(state, v);
  events.push({ kind: "voyage", tick: state.tick, text: `${vessel.name} diverted to ${PORTS[newPort].name}. ETA ${formatClock(state.startDay, v.eta)}.`, data: { voyageId: v.id } });
  return events;
}

export const hireFor = (state: State, cls: keyof typeof VESSEL_CLASSES): number => VESSEL_CLASSES[cls].hireUsdPerDay.value * state.factors.freightIndex;
