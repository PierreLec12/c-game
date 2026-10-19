import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { rankFor, RANKS, formatClock } from "@desk/engine";
import { ABOUT, CARDS, LEVELS, PLANNED_TITLES, TIERS, cardById, glossary } from "@desk/content";
import { useGame } from "../store";
import { Diagram } from "../charts/Diagram";
import { getSave } from "../persistence";

export function Academy() {
  const state = useGame((g) => g.state);
  const progress = useGame((g) => g.progress);
  const cumulative = useGame((g) => g.cumulativeScore);
  const startLevel = useGame((g) => g.startLevel);
  const resumeLevel = useGame((g) => g.resumeLevel);
  const exportCurrent = useGame((g) => g.exportCurrent);
  const importRun = useGame((g) => g.importRun);
  const openCard = useGame((g) => g.openCard);
  const nav = useNavigate();
  const [chosen, setChosen] = useState<number>(state?.level.id ?? 0);
  const [seedText, setSeedText] = useState("");
  const [cardOpen, setCardOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hasSave, setHasSave] = useState<boolean | null>(null);
  const spec = LEVELS.find((l) => l.id === chosen);
  const unlocked = (id: number) => id === 0 || (progress[id - 1]?.passed ?? false) || import.meta.env.DEV;
  useMemo(() => { void getSave(chosen).then((s) => setHasSave(!!s)); }, [chosen]);
  const terms = glossary().filter((t) => !q || t.term.toLowerCase().includes(q.toLowerCase()) || t.definition.toLowerCase().includes(q.toLowerCase()));
  const begin = (resume: boolean) => {
    if (!spec) return;
    if (resume) void resumeLevel(spec.id).then((ok) => { if (!ok) startLevel(spec.id); nav("/bridge"); });
    else { startLevel(spec.id, seedText ? Number(seedText) : undefined); nav("/bridge"); }
  };
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
          <div className="muted">{spec.subtitle} · {spec.days} day{spec.days > 1 ? "s" : ""} · capital ${(spec.capital / 1e6).toFixed(0)}m, line ${(spec.creditLine / 1e6).toFixed(0)}m <span className="stylised">stylised</span></div>
          <p className="briefing small">{spec.briefing}</p>
          <div className="small muted">Pass: {spec.passRuleText}</div>
          <div className="flex" style={{ marginTop: 8 }}>
            <button className="primary" id="start-level" onClick={() => begin(false)}>{state?.level.id === spec.id && state.level.status === "running" ? "Restart" : "Start"} level {spec.id}</button>
            {hasSave && <button onClick={() => begin(true)}>Resume saved run</button>}
            <label className="small muted">seed <input aria-label="seed" value={seedText} onChange={(e) => setSeedText(e.target.value)} placeholder={`default ${spec.seeds[(progress[spec.id]?.attempts ?? 0) % spec.seeds.length]}`} style={{ width: 90 }} /></label>
          </div>
          <h3 style={{ marginTop: 12 }}>Cards in this level</h3>
          <div className="cardlist">{spec.cards.map((c) => { const card = cardById(c.id)!; const opened = state?.level.cardsOpened.includes(c.id); return <button key={c.id} onClick={() => setCardOpen(c.id)}>{card.title}{opened && <span className="badge ok">opened</span>}</button>; })}</div>
        </div>
      )}
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
        {state?.level.score?.achievements.length ? <div className="small" style={{ marginTop: 8 }}>This run: {state.level.score.achievements.join(" · ")}</div> : null}
        <h3 style={{ marginTop: 12 }}>Runs</h3>
        <div className="flex small">
          <button onClick={() => { const j = exportCurrent(); if (!j) return; const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([j], { type: "application/json" })); a.download = `desk-level${state?.level.id}-seed${useGame.getState().seed}.json`; a.click(); }} disabled={!state}>Export this run as JSON</button>
          <label className="muted">Import a run <input type="file" accept="application/json" aria-label="import a run" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; void f.text().then((t) => { try { importRun(t); nav("/bridge"); } catch (err) { alert(String(err)); } }); }} /></label>
        </div>
        {state && <div className="small muted" style={{ marginTop: 6 }}>Current: level {state.level.id}, seed {useGame.getState().seed}, {formatClock(state.startDay, state.tick)}. A save is {`{ seed, level, log }`} plus a cached state; replaying the log from the seed rebuilds the state exactly.</div>}
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
