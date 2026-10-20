import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getLevel, runPolicy, whatIf } from "@desk/engine";
import { cardById, isSandboxId } from "@desk/content";
import { useGame } from "../store";
import { Fig } from "../components/Fig";
import { PastRuns } from "../components/PastRuns";
import { Waterfall } from "../charts/Waterfall";
import { Line } from "../charts/Line";
import { waterfallRows } from "./Book";
import { ordinal, rankAmong, runsForLevel, type RunRow } from "../persistence";

const usd = (x: number) => (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString();

export function Debrief() {
  const state = useGame((g) => g.state);
  const seed = useGame((g) => g.seed);
  const sandbox = useGame((g) => g.sandbox);
  const lastRunId = useGame((g) => g.lastRunId);
  const submit = useGame((g) => g.submit);
  const startLevel = useGame((g) => g.startLevel);
  const startSandbox = useGame((g) => g.startSandbox);
  const log = useGame((g) => g.log);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const ghost = useMemo(() => {
    if (!state || state.level.status === "running") return null;
    const spec = getLevel(state.level.id);
    const { state: bot } = runPolicy(spec, seed, spec.solve);
    return bot;
  }, [state?.level.id, state?.level.status, seed]);
  const hadHedges = !!state && state.fills.some((f) => f.tag === "hedge");
  const physical = !!state && state.cargoes.length > 0;
  const unhedged = useMemo(() => (state && state.level.status !== "running" && physical && hadHedges ? whatIf(seed, state.level.id, log, "unhedged", state.level.endedTick ?? state.tick) : null), [state?.level.id, state?.level.status, seed, log, physical, hadHedges]);
  const fullHedge = useMemo(() => (state && state.level.status !== "running" && physical ? whatIf(seed, state.level.id, log, "fullhedge", state.level.endedTick ?? state.tick) : null), [state?.level.id, state?.level.status, seed, log, physical]);
  const levelId = state?.level.id ?? null;
  const isSandbox = levelId !== null && isSandboxId(levelId); // the id is authoritative: sandbox specs live at 100 and above
  const final = !!state && (state.level.status === "passed" || state.level.status === "failed");
  // the leaderboard: every finished run of this level, refetched once this run's row has landed
  useEffect(() => {
    if (levelId === null || isSandbox) { setRuns([]); return; }
    let on = true;
    void runsForLevel(levelId).then((r) => { if (on) setRuns(r); });
    return () => { on = false; };
  }, [levelId, isSandbox, lastRunId, final]);
  if (!state) return <div className="panel"><h1>Debrief</h1><p className="notyet">not yet: start a level from the Academy.</p></div>;
  if (state.level.status === "running") return <div className="panel"><h1>Debrief</h1><p className="notyet">not yet: the level is still running. The debrief opens when it ends (or end it from the Bridge once the objectives are done).</p></div>;
  const sc = state.level.score;
  const spec = getLevel(state.level.id);
  const markers = state.fills.filter((f) => f.tag !== "forced").map((f) => ({ tick: f.tick, label: `${f.side === "buy" ? "B" : "S"}${f.qty}`, colour: f.side === "buy" ? "var(--cash)" : "var(--risk)" }));
  const eventMarkers = state.news.filter((n) => n.source !== "exchange").map((n) => ({ tick: n.tick, label: n.headline.slice(0, 24), colour: "var(--crude)" }));
  const unopened = state.level.cardsUnlocked.filter((c) => !state.level.cardsOpened.includes(c));
  const quizDone = state.level.quiz.every((q) => q.given !== undefined);
  const others = runs.filter((r) => r.id !== lastRunId);
  const rank = sc && final && !isSandbox ? rankAmong(sc.total, others) : null;
  const replaySeed = () => (sandbox ? startSandbox(sandbox.base, sandbox.knobs, seed) : startLevel(state.level.id, seed));
  const replayNew = () => (sandbox ? startSandbox(sandbox.base, sandbox.knobs) : startLevel(state.level.id));
  return (
    <div className="grid cols-2">
      <div className="panel accent-crude" style={{ gridColumn: "1 / -1" }}>
        <div className="flex"><h1 style={{ margin: 0 }}>{isSandbox ? state.level.title : `Level ${state.level.id}: ${state.level.title}`} · {isSandbox ? <span className="muted">sandbox, no score</span> : state.level.status === "passed" ? <span className="pos">passed</span> : state.level.status === "failed" ? <span className="neg">not passed</span> : <span className="muted">answer the quiz to score</span>}</h1><span className="spacer" /><button onClick={replaySeed}>Replay this seed</button><button onClick={replayNew}>Replay, new seed</button>{!isSandbox && state.level.status === "passed" && getLevelSafe(state.level.id + 1) && <Link to="/academy"><button className="primary">Next level</button></Link>}</div>
        <div className="small muted" style={{ marginTop: 4 }} id="debrief-seed">Seed <span className="mono">{seed}</span>{spec.freshSeed ? " (a fresh seed every run: type it on the Academy to replay this exact market)" : ""} · {state.level.endedTick ?? state.tick} ticks{sandbox ? ` · sandbox on level ${sandbox.base}` : ""}</div>
        {sc && !isSandbox && (
          <div style={{ marginTop: 8 }}>
            <ScoreBar label={`P&L vs par (${usd(sc.pnl)} / ${usd(sc.par)})`} value={sc.pnlComponent} max={200} />
            <ScoreBar label={`Process (${Math.round(sc.process * 100)}% of the checklist)`} value={sc.processComponent} max={50} />
            <ScoreBar label={`Drawdown (${usd(sc.maxDrawdown)} of ${usd(state.capital)})`} value={sc.drawdownComponent} max={25} />
            <ScoreBar label={`Debrief quiz (${Math.round(sc.quiz * 100)}%)`} value={sc.quizComponent} max={25} />
            <div className="flex" style={{ marginTop: 6 }}><span className="big"><Fig v={sc.total} fmt="int" what="Level score" why={`${sc.formula}. Pass: at least 100, no life lost, and the level's own rule: ${spec.passRuleText}`} /></span><span className="muted">of a possible 300 · pass at 100 · {sc.achievements.length ? `achievements: ${sc.achievements.join(", ")}` : "no achievements this run"}</span></div>
            <div className="small muted mono">{sc.formula}</div>
          </div>
        )}
        {isSandbox && sc && <div style={{ marginTop: 8 }} className="flex"><span className="big"><Fig v={sc.pnl} fmt="usd" sign what="Sandbox P&L" why="Equity minus starting capital at the end of the sandbox run. Nothing is scored or recorded." /></span><span className="muted">max drawdown {usd(sc.maxDrawdown)} · {sc.achievements.length ? `would have earned: ${sc.achievements.join(", ")}` : "no achievements"} · nothing recorded</span></div>}
      </div>
      {!isSandbox && (
        <div className="panel accent-cash" style={{ gridColumn: "1 / -1" }} id="leaderboard">
          <h2>{spec.freshSeed ? "Leaderboard against your own past runs" : "Your past runs on this level"}</h2>
          {rank ? <div style={{ marginBottom: 6 }}>This run ranks <strong>{ordinal(rank.rank)} of {rank.of}</strong> on level {state.level.id}{rank.of === 1 ? " (your first finished run)" : rank.rank === 1 ? ": your best so far" : ""}.</div> : <div className="muted small" style={{ marginBottom: 6 }}>Answer the debrief questions to score and rank this run.</div>}
          <PastRuns runs={runs} highlight={lastRunId} max={8} />
        </div>
      )}
      <div className="panel" style={{ gridColumn: "1 / -1" }}>
        <h2>Your path and the solution bot's ghost</h2>
        <Line startDay={state.startDay} format={(v) => usd(v)} series={[{ name: "your P&L", colour: "var(--crude)", points: state.pnl.equityCurve.map((p) => ({ tick: p.tick, v: p.pnl })) }, ...(ghost ? [{ name: "solution bot (same seed)", colour: "var(--mentor)", dashed: true, points: ghost.pnl.equityCurve.map((p) => ({ tick: p.tick, v: p.pnl })) }] : []), ...(unhedged ? [{ name: "what if: no hedges", colour: "var(--risk)", dashed: true, points: unhedged.pnl.equityCurve.map((p) => ({ tick: p.tick, v: p.pnl })) }] : []), ...(fullHedge ? [{ name: "what if: hedged the whole window", colour: "var(--cash)", dashed: true, points: fullHedge.pnl.equityCurve.map((p) => ({ tick: p.tick, v: p.pnl })) }] : [])]} markers={[...markers, ...eventMarkers].slice(0, 40)} />
        <Line startDay={state.startDay} height={140} format={(v) => v.toFixed(2)} series={[{ name: "Brent front mid", colour: "var(--crude)", points: state.pnl.equityCurve.map((p) => ({ tick: p.tick, v: (p as { price?: number }).price ?? 0 })) }]} markers={markers.slice(0, 40)} />
        <div className="small muted">{physical ? <>What-if: the log replayed from the same seed {hadHedges ? "with every hedge removed (red) and " : ""}with the unpriced barrels hedged one-for-one at every close (green). Ends: {unhedged ? `no hedges ${usd(unhedged.pnl.total)}` : ""}{unhedged && fullHedge ? ", " : ""}{fullHedge ? `full hedge ${usd(fullHedge.pnl.total)}` : ""}.</> : "What-if replays appear on physical levels."}</div>
      </div>
      <div className="panel">
        <h2>Where the P&L came from</h2>
        <Waterfall rows={waterfallRows(state)} total={state.pnl.total - state.pnl.unrealised} />
        {Math.abs(state.pnl.unrealised) > 1 && <div className="small muted">Plus unrealised on open lots at the end: <Fig v={state.pnl.unrealised} fmt="usd" sign what="Unrealised at the end" why="Open lots marked at the mid when the level ended." /></div>}
      </div>
      <div className="panel accent-mentor quiz">
        <h2>Debrief questions {quizDone ? <span className="badge ok">answered</span> : <span className="badge warn">{state.level.quiz.filter((q) => q.given === undefined).length} left</span>}</h2>
        {state.level.quiz.length === 0 && <div className="muted">{isSandbox ? "No questions in a sandbox: the book is the debrief." : "No questions for this level: the drills were the test."}</div>}
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
