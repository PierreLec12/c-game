/**
 * Signals that arrive before the news (section 5.4, level 17): a tanker cluster forming at anchor, a transit count
 * falling, a satellite hotspot, a cold forecast. Each series runs ahead of a scheduled event: it leaves its baseline
 * `leadTicks` before the event fires, with noise, and fades after. The feed costs money; the engine computes the
 * series whether or not the feed was bought, so a replay is identical either way.
 */
import { CHOKEPOINTS, SIGNALS, type InstrumentId } from "./refdata";
import { PORTS } from "./world_data";
import type { Stream } from "./rng";
import { HOURS_PER_DAY } from "./calendar";
import type { EngineEvent, Fill, Signal, State } from "./types";

interface SignalKindSpec { label: string; place: string; lon: number; lat: number; unit: string; baseline: number; offset: number; sd: number; cadenceHours: number; leadHours: number; inst: InstrumentId; direction: "up" | "down"; lagNote: string; what: string }
const fujairah = PORTS.FUJAIRAH, jamnagar = PORTS.JAMNAGAR, hormuz = CHOKEPOINTS.find((c) => c.id === "HORMUZ")!;
export const SIGNAL_KINDS: Record<Signal["kind"], SignalKindSpec> = {
  tanker_cluster: { label: "Tankers at anchor off Fujairah", place: "Fujairah", lon: fujairah.lon + 0.4, lat: fujairah.lat - 0.3, unit: "ships", baseline: SIGNALS.clusterBaseline.value, offset: 9, sd: 1.2, cadenceHours: 24, leadHours: 5 * 24, inst: "BRENT", direction: "down", lagNote: "a daily count from satellite positions; the headline about unsold Gulf crude follows the build by days", what: "Laden ships at anchor are oil nobody has bought yet: the prompt is oversupplied. It cannot say for how long, or whether some are simply waiting for a berth." },
  transits: { label: "Hormuz transits a day", place: "Strait of Hormuz", lon: hormuz.lon, lat: hormuz.lat, unit: "ships", baseline: SIGNALS.transitsBaseline.value, offset: -22, sd: 5, cadenceHours: 24, leadHours: 4 * 24, inst: "BRENT", direction: "up", lagNote: "a daily count of transits; owners hold back before any passage is officially restricted", what: "Fewer transits means owners are holding back or being held. It cannot tell you why: a weather day and a threat look the same for a day or two." },
  hotspot: { label: "Satellite hotspots over Jamnagar", place: "Jamnagar", lon: jamnagar.lon, lat: jamnagar.lat + 0.3, unit: "hotspots", baseline: SIGNALS.hotspotBaseline.value, offset: 7, sd: 0.8, cadenceHours: 1, leadHours: 2, inst: "ULSD", direction: "up", lagNote: "an hourly feed; a fire shows two ticks before the wire has it, a day before the operator confirms it", what: "A hotspot is heat, not a fire: furnaces and flares show too. Several confident hotspots in an hour over a complex that usually shows two a day is a fire, and a fire at a diesel exporter is a diesel crack event." },
  cold_forecast: { label: "EU heating-degree-day forecast anomaly, next 7 days", place: "North-west Europe", lon: 5.0, lat: 52.5, unit: "HDD", baseline: SIGNALS.hddBaseline.value, offset: 7, sd: 1.0, cadenceHours: 24, leadHours: 5 * 24, inst: "TTF", direction: "up", lagNote: "a daily model run; the cold itself, and the storage draw the market trades, arrive days later", what: "A forecast is a forecast: the run-to-run swing is part of the series. A rising anomaly that holds for three runs is a cold snap coming, and a cold snap drains storage faster." },
};

/** Build the signal series declared by the schedule: an event with `params.signal` gets a series that runs ahead of it. */
export function initSignals(state: State): Signal[] {
  const out: Signal[] = [];
  for (const ev of state.events) {
    const kind = ev.params.signal;
    if (typeof kind !== "string" || !(kind in SIGNAL_KINDS)) continue;
    const spec = SIGNAL_KINDS[kind as Signal["kind"]];
    const leadTicks = typeof ev.params.signalLeadHours === "number" ? ev.params.signalLeadHours : spec.leadHours;
    const offset = typeof ev.params.signalOffset === "number" ? ev.params.signalOffset : spec.offset;
    out.push({ id: `S${out.length + 1}`, kind: kind as Signal["kind"], label: spec.label, place: spec.place, lon: spec.lon, lat: spec.lat, unit: spec.unit, baseline: spec.baseline, offset, cadenceHours: spec.cadenceHours, leadTicks, eventId: ev.id, eventTick: ev.tick, firstMoveTick: ev.tick - leadTicks, headlineTick: null, inst: spec.inst, direction: spec.direction, series: [], lagNote: spec.lagNote, what: spec.what });
  }
  return out;
}

/** The shape of a series around its event: nothing, a ramp up to the event, a fade over three days after. */
export function signalShape(sig: Signal, tick: number): number {
  if (tick < sig.firstMoveTick) return 0;
  if (tick <= sig.eventTick) return sig.leadTicks > 0 ? (tick - sig.firstMoveTick) / sig.leadTicks : 1;
  return Math.max(0, 1 - (tick - sig.eventTick) / (3 * HOURS_PER_DAY));
}

/** Append a point to every series due at this tick. Daily series print at 06:00; hourly ones every hour. */
export function stepSignals(state: State, s: Stream): EngineEvent[] {
  const events: EngineEvent[] = [];
  const hour = ((state.tick % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  for (const sig of state.signals) {
    const due = sig.cadenceHours === 1 || hour === 6;
    if (!due) continue;
    const spec = SIGNAL_KINDS[sig.kind];
    const v = sig.baseline + sig.offset * signalShape(sig, state.tick) + s.normal() * spec.sd;
    const value = sig.kind === "cold_forecast" ? Math.round(v * 10) / 10 : Math.max(0, Math.round(v));
    sig.series.push({ tick: state.tick, v: value });
    if (sig.series.length > 60 * 24) sig.series.shift();
    // the first reading clearly off its baseline is an event for the feed's buyer
    const off = Math.abs(value - sig.baseline) > 2.5 * spec.sd;
    const prevOff = sig.series.length >= 2 && Math.abs(sig.series[sig.series.length - 2].v - sig.baseline) > 2.5 * spec.sd;
    if (state.feedBought && off && !prevOff && state.tick >= sig.firstMoveTick && state.tick <= sig.eventTick) events.push({ kind: "signal", tick: state.tick, text: `Signal: ${sig.label} reads ${value} ${sig.unit} against a baseline of ${sig.baseline}.`, data: { signalId: sig.id }, pause: true });
  }
  return events;
}

/** Fills tagged as signal trades that were made in a signal's window (after it moved, before its headline) in the right contract and direction. */
export function signalTrades(state: State): { signal: Signal; fills: Fill[] }[] {
  return state.signals.map((sig) => {
    const end = sig.headlineTick ?? sig.eventTick + state.infoDelayHours;
    const fills = state.fills.filter((f) => f.tag === "signal" && f.inst === sig.inst && f.tick >= sig.firstMoveTick && f.tick < end && (sig.direction === "up" ? f.side === "buy" : f.side === "sell"));
    return { signal: sig, fills };
  });
}
export const signalsVisible = (state: State): Signal[] => (state.feedBought ? state.signals : []);
/** The latest reading of a series, and whether it is off its baseline by more than the noise. */
export function signalReading(sig: Signal): { v: number | null; off: boolean } {
  const last = sig.series[sig.series.length - 1];
  if (!last) return { v: null, off: false };
  return { v: last.v, off: Math.abs(last.v - sig.baseline) > 2.5 * SIGNAL_KINDS[sig.kind].sd };
}
