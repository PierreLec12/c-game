import { useMemo } from "react";
import { Link } from "react-router-dom";
import { getLevel, runPolicy } from "@desk/engine";
import { cardById } from "@desk/content";
import { useGame } from "../store";
import { Fig } from "../components/Fig";
import { Waterfall } from "../charts/Waterfall";
import { Line } from "../charts/Line";
import { waterfallRows } from "./Book";

const usd = (x: number) => (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString();

export function Debrief() {
  const state = useGame((g) => g.state);
  const seed = useGame((g) => g.seed);
  const submit = useGame((g) => g.submit);
  const startLevel = useGame((g) => g.startLevel);
  const ghost = useMemo(() => {
    if (!state || state.level.status === "running") return null;
    const spec = getLevel(state.level.id);
    const { state: bot } = runPolicy(spec, seed, spec.solve);
    return bot;
  }, [state?.level.id, state?.level.status, seed]);
  if (!state) return <div className="panel"><h1>Debrief</h1><p className="notyet">not yet: start a level from the Academy.</p></div>;
  if (state.level.status === "running") return <div className="panel"><h1>Debrief</h1><p className="notyet">not yet: the level is still running. The debrief opens when it ends (or end it from the Bridge once the objectives are done).</p></div>;
  const sc = state.level.score;
  const spec = getLevel(state.level.id);
  const markers = state.fills.filter((f) => f.tag !== "forced").map((f) => ({ tick: f.tick, label: `${f.side === "buy" ? "B" : "S"}${f.qty}`, colour: f.side === "buy" ? "var(--cash)" : "var(--risk)" }));
  const eventMarkers = state.news.filter((n) => n.source !== "exchange").map((n) => ({ tick: n.tick, label: n.headline.slice(0, 24), colour: "var(--crude)" }));
  const unopened = state.level.cardsUnlocked.filter((c) => !state.level.cardsOpened.includes(c));
  const quizDone = state.level.quiz.every((q) => q.given !== undefined);
  return (
    <div className="grid cols-2">
      <div className="panel accent-crude" style={{ gridColumn: "1 / -1" }}>
        <div className="flex"><h1 style={{ margin: 0 }}>Level {state.level.id}: {state.level.title} · {state.level.status === "passed" ? <span className="pos">passed</span> : state.level.status === "failed" ? <span className="neg">not passed</span> : <span className="muted">answer the quiz to score</span>}</h1><span className="spacer" /><button onClick={() => startLevel(state.level.id, seed)}>Replay this seed</button><button onClick={() => startLevel(state.level.id)}>Replay, new seed</button>{state.level.status === "passed" && getLevelSafe(state.level.id + 1) && <Link to="/academy"><button className="primary">Next level</button></Link>}</div>
        {sc && (
          <div style={{ marginTop: 8 }}>
            <ScoreBar label={`P&L vs par (${usd(sc.pnl)} / ${usd(sc.par)})`} value={sc.pnlComponent} max={200} />
            <ScoreBar label={`Process (${Math.round(sc.process * 100)}% of the checklist)`} value={sc.processComponent} max={50} />
            <ScoreBar label={`Drawdown (${usd(sc.maxDrawdown)} of ${usd(state.capital)})`} value={sc.drawdownComponent} max={25} />
            <ScoreBar label={`Debrief quiz (${Math.round(sc.quiz * 100)}%)`} value={sc.quizComponent} max={25} />
            <div className="flex" style={{ marginTop: 6 }}><span className="big"><Fig v={sc.total} fmt="int" what="Level score" why={`${sc.formula}. Pass: at least 100, no life lost, and the level's own rule: ${spec.passRuleText}`} /></span><span className="muted">of a possible 300 · pass at 100 · {sc.achievements.length ? `achievements: ${sc.achievements.join(", ")}` : "no achievements this run"}</span></div>
            <div className="small muted mono">{sc.formula}</div>
          </div>
        )}
      </div>
      <div className="panel" style={{ gridColumn: "1 / -1" }}>
        <h2>Your path and the solution bot's ghost</h2>
        <Line startDay={state.startDay} format={(v) => usd(v)} series={[{ name: "your P&L", colour: "var(--crude)", points: state.pnl.equityCurve.map((p) => ({ tick: p.tick, v: p.pnl })) }, ...(ghost ? [{ name: "solution bot (same seed)", colour: "var(--mentor)", dashed: true, points: ghost.pnl.equityCurve.map((p) => ({ tick: p.tick, v: p.pnl })) }] : [])]} markers={[...markers, ...eventMarkers].slice(0, 40)} />
        <Line startDay={state.startDay} height={140} format={(v) => v.toFixed(2)} series={[{ name: "Brent front mid", colour: "var(--crude)", points: state.pnl.equityCurve.map((p) => ({ tick: p.tick, v: (p as { price?: number }).price ?? 0 })) }]} markers={markers.slice(0, 40)} />
        <div className="small muted">What-if replays ("what if I had not hedged") arrive with the first cargo in milestone 2.</div>
      </div>
      <div className="panel">
        <h2>Where the P&L came from</h2>
        <Waterfall rows={waterfallRows(state)} total={state.pnl.total - state.pnl.unrealised} />
        {Math.abs(state.pnl.unrealised) > 1 && <div className="small muted">Plus unrealised on open lots at the end: <Fig v={state.pnl.unrealised} fmt="usd" sign what="Unrealised at the end" why="Open lots marked at the mid when the level ended." /></div>}
      </div>
      <div className="panel accent-mentor quiz">
        <h2>Debrief questions {quizDone ? <span className="badge ok">answered</span> : <span className="badge warn">{state.level.quiz.filter((q) => q.given === undefined).length} left</span>}</h2>
        {state.level.quiz.length === 0 && <div className="muted">No questions for this level: the drills were the test.</div>}
        {state.level.quiz.map((q) => (
          <div className="q" key={q.id}>
            <div>{q.text}</div>
            <div className="choices">{q.choices.map((c, i) => <button key={i} className={q.given === undefined ? "" : i === q.correct ? "right" : i === q.given ? "wrong" : ""} disabled={q.given !== undefined} onClick={() => submit({ type: "answer_quiz", player: "p1", questionId: q.id, choice: i })}>{c}</button>)}</div>
            {q.given !== undefined && <div className={`small ${q.given === q.correct ? "pos" : "neg"}`} style={{ marginTop: 4 }}>{q.given === q.correct ? "Right. " : "No. "}{q.explanation}</div>}
          </div>
        ))}
        {unopened.length > 0 && <div className="small muted" style={{ marginTop: 8 }}>Cards you never opened: {unopened.map((c) => cardById(c)?.title ?? c).join(", ")}. They are in the Academy.</div>}
      </div>
    </div>
  );
}

function getLevelSafe(id: number) { try { return getLevel(id); } catch { return null; } }

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  const share = Math.min(1, Math.abs(value) / max);
  return <div className="scorebar"><span className="small muted">{label}</span><div className="bar" role="img" aria-label={`${label}: ${value.toFixed(0)}`}><i className={value < 0 ? "neg" : ""} style={{ left: value < 0 ? `${50 - share * 50}%` : "50%", width: `${share * 50}%` }} /></div><span className="num mono">{value.toFixed(0)}</span></div>;
}
