import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { rankFor } from "@desk/engine";
import { isSandboxId, RISK_MANAGER } from "@desk/content";
import { useGame } from "../store";

/**
 * The last auto-pause reason, with a way to continue; a red vignette and the risk manager's sentence on a lost life;
 * a burst and a rank card on a passed level. The feed is scanned for every new item, not only the last one, because
 * a life lost arrives in the same tick as the liquidation and the level's end.
 */
export function EventToast() {
  const pauseReason = useGame((g) => g.pauseReason);
  const feed = useGame((g) => g.feed);
  const state = useGame((g) => g.state);
  const cumulative = useGame((g) => g.cumulativeScore);
  const cardQueue = useGame((g) => g.cardQueue);
  const setSpeed = useGame((g) => g.setSpeed);
  const [flash, setFlash] = useState<{ kind: "life" | "pass"; id: number; text: string } | null>(null);
  const [rankCard, setRankCard] = useState<number | null>(null);
  const seen = useRef(0);
  const last = feed[feed.length - 1];
  useEffect(() => {
    const fresh = feed.filter((f) => f.id > seen.current);
    if (fresh.length) seen.current = fresh[fresh.length - 1].id;
    if (!state) return;
    for (const f of fresh) {
      if (f.kind === "life_lost") setFlash({ kind: "life", id: f.id, text: f.text });
      else if (f.kind === "liquidation" && !fresh.some((g) => g.kind === "life_lost")) setFlash({ kind: "life", id: f.id, text: f.text });
      if (f.kind === "level_passed") { setFlash({ kind: "pass", id: f.id, text: f.text }); if (!isSandboxId(state.level.id)) setRankCard(f.id); }
    }
  }, [last?.id]);
  // the vignette and its sentence stay a few seconds; the burst is short
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), flash.kind === "life" ? 5000 : 1800);
    return () => clearTimeout(t);
  }, [flash?.id]);
  // a new level clears the card
  useEffect(() => { setRankCard(null); }, [state?.level.id, state?.seed]);
  const important = [...feed].reverse().find((f) => ["event", "release", "margin_call", "limit_warning", "forced_reduction", "life_lost", "liquidation", "expiry", "level_ended", "level_passed", "level_failed", "news"].includes(f.kind));
  const show = pauseReason && state && pauseReason !== "paused" && pauseReason !== "briefing" && pauseReason !== "resumed";
  const sc = state?.level.score;
  const showRank = rankCard !== null && state && sc && cardQueue.length === 0;
  return (
    <>
      {flash?.kind === "life" && <div key={flash.id} className="vignette" aria-hidden="true" />}
      {flash?.kind === "life" && (
        <div key={`t${flash.id}`} className="life-banner" role="status" aria-live="assertive">
          <div className="who">{RISK_MANAGER.name}, risk</div>
          <div>{flash.text}</div>
        </div>
      )}
      {flash?.kind === "pass" && <div key={flash.id} className="burst" aria-hidden="true" />}
      {showRank && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="rank-card-title">
          <div className="modal rankcard">
            <div className="muted small">level {state.level.id} passed</div>
            <h1 id="rank-card-title">{state.level.title}</h1>
            <div className="scores">
              <div><div className="label">Score</div><div className="big mono">{Math.round(sc.total)}</div><div className="small muted">of 300 · P&L {sc.pnl < 0 ? "-$" : "$"}{Math.abs(Math.round(sc.pnl)).toLocaleString()}</div></div>
              <div><div className="label">Rank</div><div className="big">{rankFor(cumulative)}</div><div className="small muted">cumulative {Math.round(cumulative)}</div></div>
            </div>
            <div style={{ margin: "10px 0" }}>{sc.achievements.length ? <>Achievements: {sc.achievements.map((a) => <span key={a} className="badge ok">{a}</span>)}</> : <span className="muted">No achievements this run.</span>}</div>
            <div className="flex">
              <Link to="/debrief" onClick={() => setRankCard(null)}><button className="primary">Open the debrief</button></Link>
              <button id="rank-card-close" onClick={() => setRankCard(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {show && (
        <div className="panel accent-crude" role="status" style={{ position: "fixed", right: 16, bottom: 16, width: "min(420px, calc(100% - 32px))", zIndex: 80 }}>
          <div className="muted small">clock paused</div>
          <div style={{ margin: "4px 0 8px" }}>{important && important.text.length > pauseReason.length ? important.text : pauseReason}</div>
          <div className="flex">
            {state.level.status === "running" ? <button className="primary" onClick={() => setSpeed(1)}>Continue (space)</button> : <a href="#/debrief"><button className="primary">Open the debrief</button></a>}
          </div>
        </div>
      )}
    </>
  );
}
