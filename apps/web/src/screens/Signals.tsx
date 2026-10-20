/**
 * The signals feed (level 17): series that run ahead of the news. The engine computes them whether or not the feed
 * is bought; buying only changes what is visible. Each row says what the series can and cannot tell you.
 */
import { formatClock, INSTRUMENTS, SIGNAL_KINDS, SIGNALS, signalReading, signalsVisible, signalTrades, type Signal, type State } from "@desk/engine";
import { useGame } from "../store";
import { Fig } from "../components/Fig";
import { Sparkline } from "../charts/Sparkline";

export function SignalsPanel({ state }: { state: State }) {
  const submit = useGame((g) => g.submit);
  const refusals = useGame((g) => g.refusals);
  const canBuy = state.level.unlockedActions.includes("buy_feed");
  const visible = signalsVisible(state);
  if (!canBuy && !state.feedBought) return <div className="notyet">not yet: anchored tanker clusters, transit counts, hotspots and degree days arrive at level 17 (Signals).</div>;
  if (!state.feedBought) {
    const lastRefusal = [...refusals].reverse().find((r) => r.action.type === "buy_feed");
    return (
      <div>
        <button className="primary" id="buy-feed" onClick={() => submit({ type: "buy_feed", player: "p1" })} disabled={state.level.status !== "running"}>Buy the feed (${SIGNALS.feedCostUsd.value.toLocaleString()})</button>
        <div className="small muted" style={{ marginTop: 6 }}>Tankers at anchor, strait transits, satellite hotspots and the degree-day forecast, each hours to days ahead of the headline it precedes; the engine computes them whether you pay or not, so the feed changes only what you can see.{state.signals.length === 0 && " This level has no signal series: the feed would show nothing."}</div>
        {lastRefusal && <div className="refusal" role="alert">Refused: {lastRefusal.reason}</div>}
      </div>
    );
  }
  if (visible.length === 0) return <div className="notyet">not yet: the feed is on, but this level has no signal series.</div>;
  const trades = signalTrades(state);
  return <div>{visible.map((sig) => <SignalRow key={sig.id} state={state} sig={sig} fills={trades.find((t) => t.signal.id === sig.id)?.fills.length ?? 0} />)}</div>;
}

function SignalRow({ state, sig, fills }: { state: State; sig: Signal; fills: number }) {
  const { v, off } = signalReading(sig);
  const sd = SIGNAL_KINDS[sig.kind].sd;
  const last = sig.series[sig.series.length - 1];
  const decimals = sig.kind === "cold_forecast" ? 1 : 0;
  return (
    <div style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
      <div className="flex">
        <strong>{sig.label}</strong><span className="muted small">{sig.place}</span>
        {off && <span className="badge warn">off its baseline</span>}
        <span className="spacer" />
        <span className="small muted">bears on {INSTRUMENTS[sig.inst].name}, {sig.direction}</span>
      </div>
      <div className="flex small" style={{ margin: "4px 0" }}>
        <span>latest <Fig v={v} fmt="px" decimals={decimals} what={`${sig.label} (${sig.unit})`} why={`${sig.what} Lag: ${sig.lagNote}.`} at={last?.tick} notYet={sig.cadenceHours === 1 ? "No reading yet: an hourly feed." : "No reading yet: a daily series, printed at 06:00."} /> {sig.unit}</span>
        <span className="muted">baseline <Fig v={sig.baseline} fmt="px" decimals={decimals} what={`${sig.label}: baseline`} why={`A normal day's reading (stylised). The badge shows when the latest reading is more than 2.5 noise standard deviations (${sd} ${sig.unit}) away.`} stylised /></span>
        <Sparkline points={sig.series.map((p) => p.v)} baseline={sig.baseline} colour={off ? "var(--crude)" : "var(--gas)"} label={`${sig.label} series`} />
        {fills > 0 && <span className="badge ok">{fills} trade{fills > 1 ? "s" : ""} on it</span>}
        {sig.headlineTick !== null && <span className="badge">headline at {formatClock(state.startDay, sig.headlineTick).slice(4)}</span>}
      </div>
      <div className="small muted">{sig.what} <span className="dim">Lag: {sig.lagNote}.</span></div>
    </div>
  );
}
