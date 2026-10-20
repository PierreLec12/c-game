import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rankFor, RANKS, formatClock, type Regime } from "@desk/engine";
import { ABOUT, CARDS, LEVELS, PLANNED_TITLES, TIERS, cardById, glossary, isSandboxId, SANDBOX_ID_BASE, type SandboxKnobs } from "@desk/content";
import { useGame } from "../store";
import { Diagram } from "../charts/Diagram";
import { allSaves, getSave, runsForLevel, type RunRow, type Save } from "../persistence";
import { PastRuns } from "../components/PastRuns";

export function Academy() {
  const state = useGame((g) => g.state);
  const seed = useGame((g) => g.seed);
  const sandbox = useGame((g) => g.sandbox);
  const lastRunId = useGame((g) => g.lastRunId);
  const progress = useGame((g) => g.progress);
  const cumulative = useGame((g) => g.cumulativeScore);
  const startLevel = useGame((g) => g.startLevel);
  const resumeLevel = useGame((g) => g.resumeLevel);
  const exportCurrent = useGame((g) => g.exportCurrent);
  const importRun = useGame((g) => g.importRun);
  const openCard = useGame((g) => g.openCard);
  const nav = useNavigate();
  const [chosen, setChosen] = useState<number>(state ? (isSandboxId(state.level.id) ? state.level.id - SANDBOX_ID_BASE : state.level.id) : 0);
  const [seedText, setSeedText] = useState("");
  const [cardOpen, setCardOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hasSave, setHasSave] = useState<boolean | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const spec = LEVELS.find((l) => l.id === chosen);
  const unlocked = (id: number) => id === 0 || (progress[id - 1]?.passed ?? false) || import.meta.env.DEV;
  useMemo(() => { void getSave(chosen).then((s) => setHasSave(!!s)); }, [chosen]);
  useEffect(() => { let on = true; void runsForLevel(chosen).then((r) => { if (on) setRuns(r); }); return () => { on = false; }; }, [chosen, lastRunId]);
  const terms = glossary().filter((t) => !q || t.term.toLowerCase().includes(q.toLowerCase()) || t.definition.toLowerCase().includes(q.toLowerCase()));
  const begin = (resume: boolean) => {
    if (!spec) return;
    if (resume) void resumeLevel(spec.id).then((ok) => { if (!ok) startLevel(spec.id); nav("/bridge"); });
    else { startLevel(spec.id, seedText ? Number(seedText) : undefined); nav("/bridge"); }
  };
  const runningThis = !!state && state.level.id === chosen && !sandbox;
  return (
    <div className="grid cols-2">
      <div className="panel accent-mentor" style={{ gridColumn: "1 / -1" }}>
        <div className="flex"><h1 style={{ margin: 0 }}>Academy</h1><span className="spacer" /><span className="muted">Rank: <strong>{rankFor(cumulative)}</strong> · cumulative score {Math.round(cumulative)} · next rank at {RANKS.find((r) => r.from > cumulative)?.from ?? "max"}</span></div>
        <div className="path" style={{ marginTop: 8 }}>
          {TIERS.map((t) => (
            <div className="tier" key={t.tier}>
              <div><strong>Tier {t.tier}: {t.name}</strong></div>
              <div className="levels">
                {t.levels.map((id) => {
                  const l = LEVELS.find((x) => x.id === id);
                  const p = progress[id];
                  const playable = !!l && unlocked(id);
                  return (
                    <button key={id} className={`level-chip ${!playable ? "locked" : ""} ${p?.passed ? "passed" : ""} ${chosen === id ? "active" : ""}`} onClick={() => playable && setChosen(id)} disabled={!playable} aria-label={`level ${id} ${l?.title ?? PLANNED_TITLES[id]}`} title={!l ? `not yet: built in milestone ${id <= 9 ? 2 : id <= 13 ? 3 : id <= 17 ? 4 : 5}` : !playable ? "pass the previous level first" : ""}>
                      <div className="n">Level {id}{p?.passed ? " · passed" : p ? ` · ${p.attempts} attempt${p.attempts > 1 ? "s" : ""}` : ""}{!l ? " · not yet" : ""}</div>
                      <div>{l?.title ?? PLANNED_TITLES[id]}</div>
                      {p && <div className="small muted">best {Math.round(p.bestScore)}</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {spec && (
        <div className="panel accent-crude">
          <h2>Level {spec.id}: {spec.title}</h2>
          <div className="muted">{spec.subtitle} · {spec.days} day{spec.days > 1 ? "s" : ""}{spec.endless ? " at most (endless: you end it)" : ""} · capital ${(spec.capital / 1e6).toFixed(0)}m, line ${(spec.creditLine / 1e6).toFixed(0)}m <span className="stylised">stylised</span></div>
          <p className="briefing small">{spec.briefing}</p>
          <div className="small muted">Pass: {spec.passRuleText}</div>
          <div className="flex" style={{ marginTop: 8 }}>
            <button className="primary" id="start-level" onClick={() => begin(false)}>{runningThis && state.level.status === "running" ? "Restart" : "Start"} level {spec.id}</button>
            {hasSave && <button onClick={() => begin(true)}>Resume saved run</button>}
            <label className="small muted">seed <input aria-label="seed" value={seedText} onChange={(e) => setSeedText(e.target.value)} placeholder={spec.freshSeed ? "fresh each run" : `default ${spec.seeds[(progress[spec.id]?.attempts ?? 0) % spec.seeds.length]}`} style={{ width: 110 }} /></label>
          </div>
          {spec.freshSeed && (
            <div className="small muted" style={{ marginTop: 6 }} id="fresh-seed">
              {spec.title} picks a fresh seed every run; the seed is in the save and the debrief, so any run can be replayed by typing it here.
              {runningThis ? <> This run: <span className="mono">seed {seed}</span>.</> : null}
              {!runningThis && progress[spec.id]?.lastSeed ? <> Last run: <span className="mono">seed {progress[spec.id].lastSeed}</span>.</> : null}
            </div>
          )}
          <h3 style={{ marginTop: 12 }}>{spec.freshSeed ? "Leaderboard against your own past runs" : "Your past runs on this level"}</h3>
          <PastRuns runs={runs} />
          <h3 style={{ marginTop: 12 }}>Cards in this level</h3>
          <div className="cardlist">{spec.cards.map((c) => { const card = cardById(c.id)!; const opened = state?.level.cardsOpened.includes(c.id); return <button key={c.id} onClick={() => setCardOpen(c.id)}>{card.title}{opened && <span className="badge ok">opened</span>}</button>; })}</div>
        </div>
      )}
      <SandboxPanel />
      <div className="panel">
        <h2>Glossary</h2>
        <input aria-label="search the glossary" placeholder="search" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
        <div style={{ maxHeight: 360, overflow: "auto" }} tabIndex={0} aria-label="glossary entries">
          <table><tbody>{terms.map((t) => <tr key={t.term}><td><strong>{t.term}</strong><span className="badge">L{t.level}</span></td><td className="small">{t.definition} <button className="ghost small" onClick={() => setCardOpen(t.cardId)}>card</button></td></tr>)}</tbody></table>
        </div>
      </div>
      <div className="panel">
        <h2>Achievements and progress</h2>
        {Object.values(progress).length === 0 ? <div className="muted">Nothing yet. Level 0 is two minutes.</div> : <table><thead><tr><th>Level</th><th className="num">Best score</th><th>Attempts</th><th>Status</th></tr></thead><tbody>{Object.values(progress).sort((a, b) => a.level - b.level).map((p) => <tr key={p.level}><td>{p.level}: {LEVELS.find((l) => l.id === p.level)?.title}</td><td className="num">{Math.round(p.bestScore)}</td><td>{p.attempts}</td><td><span className={`badge ${p.passed ? "ok" : "warn"}`}>{p.passed ? "passed" : "not yet"}</span></td></tr>)}</tbody></table>}
        {state?.level.score?.achievements.length ? <div className="small" style={{ marginTop: 8 }}>This run: {state.level.score.achievements.join(" · ")}{sandbox ? " (sandbox: not recorded)" : ""}</div> : null}
        <h3 style={{ marginTop: 12 }}>Runs</h3>
        <div className="flex small">
          <button onClick={() => { const j = exportCurrent(); if (!j) return; const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([j], { type: "application/json" })); a.download = `desk-${sandbox ? `sandbox${sandbox.base}` : `level${state?.level.id}`}-seed${useGame.getState().seed}.json`; a.click(); }} disabled={!state}>Export this run as JSON</button>
          <label className="muted">Import a run <input type="file" accept="application/json" aria-label="import a run" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; void f.text().then((t) => { try { importRun(t); nav("/bridge"); } catch (err) { alert(String(err)); } }); }} /></label>
        </div>
        {state && <div className="small muted" style={{ marginTop: 6 }}>Current: {sandbox ? `sandbox on level ${sandbox.base}` : `level ${state.level.id}`}, seed {seed}, {formatClock(state.startDay, state.tick)}. A save is {`{ seed, level, log }`} plus a cached state{sandbox ? " and the sandbox knobs" : ""}; replaying the log from the seed rebuilds the state exactly.</div>}
      </div>
      <div className="panel" style={{ gridColumn: "1 / -1" }}>
        <h2>About</h2>
        <p className="briefing small">{ABOUT}</p>
        <div className="small muted">Keyboard: <span className="kbd">space</span> pause · <span className="kbd">1</span> <span className="kbd">2</span> <span className="kbd">3</span> speed · <span className="kbd">N</span> next event. Every number explains itself on hover or focus.</div>
      </div>
      {cardOpen && (() => { const card = cardById(cardOpen); if (!card) return null; return (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="academy-card">
          <div className="modal">
            <div className="muted small">concept card · level {card.level}</div>
            <h1 id="academy-card">{card.title}</h1>
            <Diagram kind={card.diagram} />
            <div className="sentences">{card.sentences.map((s, i) => <p key={i}>{s}</p>)}</div>
            <div className="worked">{state ? card.worked(state) : "Start a level to see this worked on your own book."}</div>
            <div className="flex"><button className="primary" onClick={() => { if (state) openCard(card.id); setCardOpen(null); }}>Close</button>{state && <button onClick={() => { openCard(card.id); setCardOpen(null); nav(`/${card.showMe.screen}#${card.showMe.target}`); }}>Show me: {card.showMe.label}</button>}</div>
          </div>
        </div>); })()}
      <div className="sr-only">{CARDS.length} cards</div>
    </div>
  );
}

const REGIMES: Regime[] = ["calm", "normal", "stressed", "crisis"];

/** Sandbox mode (section 9, level 20): any level, any seed, any knob, no score. */
function SandboxPanel() {
  const startSandbox = useGame((g) => g.startSandbox);
  const resumeLevel = useGame((g) => g.resumeLevel);
  const current = useGame((g) => g.state);
  const nav = useNavigate();
  const [saved, setSaved] = useState<Save[]>([]);
  // sandbox saves live under their sandbox id (100 + base), so the level panel's Resume button never sees them
  useEffect(() => { let on = true; void allSaves().then((all) => { if (on) setSaved(all.filter((x) => x.sandbox && isSandboxId(x.level))); }); return () => { on = false; }; }, [current?.level.id]);
  const [base, setBase] = useState<number>(LEVELS[LEVELS.length - 1].id);
  const [seedText, setSeedText] = useState("");
  const [k, setK] = useState<Record<string, string>>({});
  const [adversarial, setAdversarial] = useState(false);
  const [noEvents, setNoEvents] = useState(false);
  const spec = LEVELS.find((l) => l.id === base) ?? LEVELS[0];
  const num = (key: string): number | undefined => { const v = k[key]; if (v === undefined || v.trim() === "") return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined; };
  const field = (key: string, label: string, placeholder: string, extra: { step?: number; min?: number; width?: number } = {}) => (
    <label className="small muted">{label} <input aria-label={`sandbox ${label}`} type="number" inputMode="decimal" value={k[key] ?? ""} onChange={(e) => setK({ ...k, [key]: e.target.value })} placeholder={placeholder} step={extra.step ?? 1} min={extra.min} style={{ width: extra.width ?? 90 }} /></label>
  );
  const start = () => {
    const knobs: SandboxKnobs = {};
    const days = num("days"); if (days !== undefined && days >= 1) knobs.days = Math.round(days);
    const capital = num("capital"); if (capital !== undefined && capital > 0) knobs.capital = Math.round(capital * 1e6);
    const line = num("line"); if (line !== undefined && line >= 0) knobs.creditLine = Math.round(line * 1e6);
    if (k.regime && REGIMES.includes(k.regime as Regime)) knobs.regime = k.regime as Regime;
    const delay = num("delay"); if (delay !== undefined && delay >= 0) knobs.infoDelayHours = Math.round(delay);
    const scale = num("limitScale"); if (scale !== undefined && scale > 0) knobs.limitScale = scale;
    const lives = num("lives"); if (lives !== undefined && lives >= 1) knobs.lives = Math.round(lives);
    const depth = num("backMonthDepth"); if (depth !== undefined && depth > 0) knobs.backMonthDepth = depth;
    const stress = num("stressDepth"); if (stress !== undefined && stress > 0) knobs.stressDepth = stress;
    if (adversarial) knobs.adversarial = true;
    if (noEvents) knobs.noEvents = true;
    const seed = seedText.trim() ? Number(seedText) : undefined;
    startSandbox(base, knobs, seed !== undefined && Number.isFinite(seed) ? Math.round(seed) : undefined);
    nav("/bridge");
  };
  return (
    <div className="panel accent-gas" id="sandbox">
      <h2>Sandbox (any level, any seed, any knob, no score)</h2>
      <div className="small muted">A sandbox run is any registered level with its knobs changed. It has no pass rule, no par and no debrief score, records nothing in your progress or rank, and saves and exports like any run (the knobs travel with the file). Leave a knob blank to keep the level's own value.</div>
      <div className="flex" style={{ marginTop: 8 }}>
        <label className="small muted">base level <select aria-label="sandbox base level" value={base} onChange={(e) => setBase(Number(e.target.value))}>{LEVELS.map((l) => <option key={l.id} value={l.id}>{l.id}: {l.title}</option>)}</select></label>
        <label className="small muted">seed <input aria-label="sandbox seed" value={seedText} onChange={(e) => setSeedText(e.target.value)} placeholder="fresh" inputMode="numeric" style={{ width: 110 }} /></label>
      </div>
      <div className="flex knobs" style={{ marginTop: 8 }}>
        {field("days", "days", String(spec.days), { min: 1 })}
        {field("capital", "capital $m", (spec.capital / 1e6).toFixed(0), { min: 1 })}
        {field("line", "line $m", (spec.creditLine / 1e6).toFixed(0), { min: 0 })}
        <label className="small muted">regime <select aria-label="sandbox regime" value={k.regime ?? ""} onChange={(e) => setK({ ...k, regime: e.target.value })}><option value="">level's ({spec.regime})</option>{REGIMES.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
        {field("delay", "info delay hours", String(spec.infoDelayHours ?? 0), { min: 0 })}
        {field("limitScale", "limit scale", "1", { step: 0.25, min: 0.25 })}
        {field("lives", "lives", String(spec.lives), { min: 1 })}
        {field("backMonthDepth", "back-month depth", String(spec.backMonthDepth ?? 1), { step: 0.25, min: 0.25 })}
        {field("stressDepth", "stress depth", String(spec.stressDepth ?? 1), { step: 0.25, min: 0.25 })}
        <label className="small muted"><input type="checkbox" checked={adversarial} onChange={(e) => setAdversarial(e.target.checked)} aria-label="sandbox adversarial counterparties" /> adversarial</label>
        <label className="small muted"><input type="checkbox" checked={noEvents} onChange={(e) => setNoEvents(e.target.checked)} aria-label="sandbox quiet market" /> quiet market (no events)</label>
      </div>
      {saved.length > 0 && (
        <div className="flex small" style={{ marginTop: 8 }} id="sandbox-saves">
          <span className="muted">Saved sandbox runs:</span>
          {saved.map((x) => <button key={x.level} onClick={() => void resumeLevel(x.level).then((ok) => { if (ok) nav("/bridge"); })}>Resume level {x.sandbox!.base} seed {x.seed} ({formatClock(x.state.startDay, x.tick)})</button>)}
        </div>
      )}
      <div className="flex" style={{ marginTop: 8 }}>
        <button className="primary" id="start-sandbox" onClick={start}>Start sandbox on level {base}</button>
        <span className="small muted">Limit scale multiplies every risk limit; depth knobs multiply the lots at the touch (back months, and in stress); adversarial counterparties price your known positions against you.</span>
      </div>
    </div>
  );
}
