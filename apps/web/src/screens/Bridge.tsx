import { Link } from "react-router-dom";
import { anchors, ckey, formatClock, grossLots, INSTRUMENTS, monthLabel, nextRelease, type InstrumentId } from "@desk/engine";
import { LEVELS, MENTOR } from "@desk/content";
import { useGame } from "../store";
import { Fig } from "../components/Fig";
import { Gauge } from "../charts/Gauge";
import { Feed } from "../components/Feed";
import { Drills } from "../components/Drills";

const usdK = (x: number) => (Math.abs(x) >= 1e6 ? "$" + (x / 1e6).toFixed(1) + "m" : "$" + Math.round(x / 1e3) + "k");

export function Bridge() {
  const state = useGame((g) => g.state);
  const setSpeed = useGame((g) => g.setSpeed);
  const submit = useGame((g) => g.submit);
  if (!state) return <div className="panel"><h1>Bridge</h1><p className="muted">No level running. <Link to="/academy">Open the Academy</Link> and start level 0: it takes two minutes.</p></div>;
  const spec = LEVELS.find((l) => l.id === state.level.id)!;
  const rel = nextRelease(state);
  const gross = grossLots(state);
  const lastMentor = state.level.mentorLines[state.level.mentorLines.length - 1];
  const refs = { brentRef: spec.factors.brentRef ?? 75, hhRef: spec.factors.hhRef ?? 3, ttfRef: spec.factors.ttfRef ?? 35 };
  const fair = Math.exp(anchors(state.world, state.factors, refs, state.startDay + Math.floor(state.tick / 24)).logBrent);
  const front = state.quotes[ckey("BRENT", state.listed.BRENT[0])];
  return (
    <div className="grid cols-2">
      <div className="panel accent-crude">
        <h1>Level {state.level.id}: {state.level.title}</h1>
        <div className="muted">{spec.subtitle}</div>
        <p className="briefing small">{spec.briefing}</p>
        <div className="flex">
          {state.level.status === "running" && <button className="primary" onClick={() => setSpeed(1)}>Start the clock (space)</button>}
          {state.level.status === "running" && state.level.objectives.every((o) => o.status === "done") && <button onClick={() => submit({ type: "end_level", player: "p1" })}>End the level now</button>}
          {state.level.status !== "running" && <Link to="/debrief"><button className="primary">Open the debrief</button></Link>}
          <span className="muted small">Pass: {spec.passRuleText}</span>
        </div>
      </div>
      <div className="panel accent-risk">
        <h2>Risk</h2>
        <div className="gauges">
          <Gauge name="VaR / limit" value={state.risk.var95?.v ?? null} limit={state.risk.limits.var95} format={usdK} />
          <Gauge name="Gross / limit" value={gross} limit={state.risk.limits.grossLots} format={(x) => `${Math.round(x)}`} colour="var(--gas)" />
          <Gauge name="Drawdown / limit" value={state.risk.maxDrawdown} limit={state.risk.limits.drawdown} format={usdK} colour="var(--products)" />
          <Gauge name="Stop-loss used" value={Math.max(0, -(state.pnl.total - state.risk.stopLossRef))} limit={state.risk.limits.stopLoss} format={usdK} colour="var(--risk)" />
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>Lives {state.risk.lives} of {spec.lives}. {state.risk.messages.length ? `Risk: "${state.risk.messages[state.risk.messages.length - 1].text}"` : "Risk has nothing to say yet."}</div>
      </div>
      <div className="panel">
        <h2>Objectives</h2>
        <ul className="checklist">
          {state.level.objectives.map((o) => <li key={o.id}><span className={`dot ${o.status}`} role="img" aria-label={o.status} /><span>{o.text}{o.detail && <span className="muted small"> · {o.detail}</span>}</span></li>)}
        </ul>
      </div>
      <div className="panel accent-mentor">
        <h2>{MENTOR.name}, mentor</h2>
        <p style={{ fontSize: 15 }}>{lastMentor ? lastMentor.text : "…"}</p>
        <AskMentor />
      </div>
      <div className="panel">
        <h2>Ticker</h2>
        <div className="ticker">
          {state.level.instruments.map((inst) => {
            const m = state.listed[inst][0];
            const q = state.quotes[ckey(inst, m)];
            const c = state.contracts[ckey(inst, m)];
            const sp = INSTRUMENTS[inst as InstrumentId];
            const chg = c?.settle ? q.mid - c.settle.v : null;
            return <span className="item" key={inst}><span className="muted">{sp.name} {monthLabel(m)}</span><Fig v={q.mid} fmt="px" decimals={sp.decimals} what={`${sp.name} ${monthLabel(m)} mid`} why={q.why} at={q.at} />{chg !== null ? <Fig v={chg} fmt="signed" decimals={sp.decimals} sign what="Change since the last settle" why={`Mid now minus the last settle of ${c.settle!.v.toFixed(sp.decimals)}.`} /> : <span className="notyet">no settle yet</span>}</span>;
          })}
        </div>
        {state.level.tier <= 1 && front && (
          <div className="small" style={{ marginTop: 6 }}>Desk view: Brent fair value <Fig v={fair} fmt="px" what="The desk's fundamental model (stylised)" why={`The desk's own model of where the prompt belongs given the stock picture (OECD gap ${state.world.oecdInvGap.toFixed(0)} mb versus normal) and the risk index (${state.world.geo.toFixed(2)}). The market drifts toward it slowly; it is a view, not a size.`} stylised /> against a front mid of <Fig v={front.mid} fmt="px" what="Brent front mid" why={front.why} at={front.at} />.</div>
        )}
      </div>
      <div className="panel">
        <h2>Calendar</h2>
        {rel ? <div>Next: <strong>{rel.name}</strong> at {formatClock(state.startDay, rel.tick)}{rel.consensus ? <> · consensus <Fig v={rel.consensus.v} fmt="signed" decimals={1} what={`${rel.name} consensus (${rel.unit})`} why={rel.consensus.why} at={rel.consensus.at} /> {rel.unit}</> : <span className="muted"> · consensus published on the day</span>}</div> : <div className="muted">No scheduled release left in this level.</div>}
        <div className="small muted" style={{ marginTop: 6 }}>Open tenders: <span className="notyet">not yet (physical unlocks at level 5)</span></div>
        <div className="small muted">Level ends {formatClock(state.startDay, state.level.endTick)}.</div>
      </div>
      <Drills />
      <div className="panel">
        <h2>What happened</h2>
        <Feed max={30} />
      </div>
    </div>
  );
}

function AskMentor() {
  const submit = useGame((g) => g.submit);
  const topics = ["size", "margin", "the spread", "my P&L", "the release", "the leak"];
  return <div className="flex small">{topics.map((t) => <button key={t} className="ghost" onClick={() => submit({ type: "ask_mentor", player: "p1", topic: t })}>Ask about {t}</button>)}</div>;
}
