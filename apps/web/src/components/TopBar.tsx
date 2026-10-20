import { NavLink } from "react-router-dom";
import { formatClock, rankFor } from "@desk/engine";
import { isSandboxId } from "@desk/content";
import { useGame, type Speed } from "../store";
import { Fig } from "./Fig";

const SCREENS: [string, string][] = [["bridge", "Bridge"], ["markets", "Markets"], ["desk", "Desk"], ["map", "Map"], ["book", "Book & risk"], ["intel", "Intel"], ["finance", "Finance"], ["academy", "Academy"], ["debrief", "Debrief"]];

export function TopBar() {
  const state = useGame((g) => g.state);
  const speed = useGame((g) => g.speed);
  const setSpeed = useGame((g) => g.setSpeed);
  const cumulative = useGame((g) => g.cumulativeScore);
  const pauseReason = useGame((g) => g.pauseReason);
  const running = state?.level.status === "running";
  const SpeedBtn = ({ s, label, keyHint }: { s: Speed; label: string; keyHint: string }) => (
    <button className={speed === s ? "active" : ""} onClick={() => setSpeed(s)} disabled={!running} aria-label={`${label} (key ${keyHint})`} title={`${label}: key ${keyHint}`}>{label}</button>
  );
  const equity = state ? state.finance.cashUSD + state.finance.cashEUR * state.factors.eurusd + state.finance.marginAccount - state.finance.lineDrawn : 0;
  return (
    <>
      <header className="topbar" role="banner">
        <span className="brand">DESK</span>
        <div className="stat"><span className="label">Clock</span><span className="value">{state ? formatClock(state.startDay, state.tick) : "no level"}</span></div>
        <div className="speed" role="group" aria-label="clock speed">
          <SpeedBtn s={0} label="Pause" keyHint="space" />
          <SpeedBtn s={1} label="1x" keyHint="1" />
          <SpeedBtn s={4} label="4x" keyHint="2" />
          <SpeedBtn s={12} label="12x" keyHint="3" />
          <SpeedBtn s="next" label="Next event" keyHint="N" />
        </div>
        {state && (
          <>
            <div className="stat"><span className="label">Net cash</span><span className="value"><Fig v={equity} fmt="usdK" what="Cash and margin held, less the line drawn" why={`Cash $${Math.round(state.finance.cashUSD).toLocaleString()} + EUR ${Math.round(state.finance.cashEUR).toLocaleString()} at ${state.factors.eurusd.toFixed(4)} + margin held $${Math.round(state.finance.marginAccount).toLocaleString()} - line drawn $${Math.round(state.finance.lineDrawn).toLocaleString()}. Every movement is a ledger row on Finance.`} /></span></div>
            <div className="stat"><span className="label">P&L today</span><span className="value"><Fig v={state.pnl.today} fmt="usdK" sign what="P&L since the last settle" why="Level P&L now minus level P&L at the last settle: variation margin received since plus the unrealised change on open lots." /></span></div>
            <div className="stat"><span className="label">P&L level</span><span className="value"><Fig v={state.pnl.total} fmt="usdK" sign what="Level P&L" why="Equity minus starting capital: realised variation margin, closed lots, fees, interest, and unrealised P&L on open lots at the mid. The Book's waterfall splits it by leg." /></span></div>
            <div className="stat"><span className="label">VaR / limit</span><span className="value"><Fig v={state.risk.var95?.v ?? null} fmt="usdK" what="One-day 95% VaR" why={state.risk.var95?.why} at={state.risk.var95?.at} notYet="Fewer than 20 simulated sessions share a history for every contract in the book." /> / <Fig v={state.risk.limits.var95} fmt="usdK" what="VaR limit" why="The risk manager's one-day 95% VaR limit for this level." /></span></div>
            <div className="stat"><span className="label">Lives</span><span className="value" aria-label={`${state.risk.lives} lives`}>{"●".repeat(state.risk.lives)}{"○".repeat(Math.max(0, 3 - state.risk.lives))}</span></div>
            <div className="stat"><span className="label">Rank</span><span className="value">{rankFor(cumulative)}</span></div>
            <div className="stat level"><span className="label">{isSandboxId(state.level.id) ? "Sandbox" : "Level"}</span><span className="value">{isSandboxId(state.level.id) ? state.level.title.replace(/^Sandbox:\s*/, "") : `${state.level.id}: ${state.level.title}`}</span></div>
          </>
        )}
        {pauseReason && state && <span className="badge warn" aria-live="polite">paused: {pauseReason}</span>}
      </header>
      <nav className="tabs" aria-label="screens">
        {SCREENS.map(([path, label]) => <NavLink key={path} to={`/${path}`} className={({ isActive }) => (isActive ? "active" : "")}>{label}</NavLink>)}
      </nav>
    </>
  );
}
