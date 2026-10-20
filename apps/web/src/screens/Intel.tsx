import { formatClock } from "@desk/engine";
import { useGame } from "../store";
import { Fig } from "../components/Fig";

export function Intel() {
  const state = useGame((g) => g.state);
  if (!state) return <div className="panel"><h1>Intel</h1><p className="notyet">not yet: start a level from the Academy.</p></div>;
  const news = [...state.news].reverse();
  const releases = [...state.releases].sort((a, b) => a.tick - b.tick);
  return (
    <div className="grid cols-2">
      <div className="panel accent-crude" id="news">
        <h2>News</h2>
        {news.length === 0 ? <div className="muted">Quiet.</div> : news.map((n) => (
          <div key={n.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
            <div className="flex"><strong>{n.headline}</strong><span className={`badge ${n.source === "leak" || n.source === "rumour" ? "warn" : ""}`}>{n.source}</span>{n.resolved && <span className={`badge ${n.resolved.outcome === "true" ? "ok" : "bad"}`}>resolved {n.resolved.outcome}</span>}</div>
            <div className="small muted">{formatClock(state.startDay, n.tick)}{n.shockTick !== undefined && <span className="badge warn">the market moved at {formatClock(state.startDay, n.shockTick).slice(4)}</span>} · {n.body}</div>
            {n.resolved && <div className="small">{n.resolved.text} <span className="muted">Base rate for a {n.source}: <Fig v={n.reliability} fmt="pct" what="Reliability of this source type" why="The share of items from this source type that turn out true, shown after resolution so the base rate is learned, not guessed." /></span></div>}
          </div>
        ))}
      </div>
      <div>
        <div className="panel" id="calendar">
          <h2>Release calendar</h2>
          <table><thead><tr><th>Release</th><th>When</th><th className="num">Consensus</th><th className="num">Actual</th></tr></thead>
            <tbody>{releases.map((r) => <tr key={r.id} className={r.published ? "muted" : ""}><td>{r.name}</td><td className="small">{formatClock(state.startDay, r.tick)}</td><td className="num">{r.consensus ? <Fig v={r.consensus.v} fmt="signed" decimals={1} what={`${r.name} consensus (${r.unit})`} why={r.consensus.why} at={r.consensus.at} /> : <Fig v={null} what="Consensus" notYet={r.name === "Weekly crude inventories" ? "Published on the morning of the release." : "This release has no consensus figure."} />}</td><td className="num">{r.actual ? <Fig v={r.actual.v} fmt="signed" decimals={1} what={`${r.name} actual (${r.unit})`} why={r.actual.why} at={r.actual.at} /> : <Fig v={null} what="Actual" notYet="Not published yet." />}</td></tr>)}
              {releases.length === 0 && <tr><td colSpan={4} className="muted">No scheduled releases in this level.</td></tr>}</tbody></table>
        </div>
        <div className="panel" style={{ marginTop: 14 }}>
          <h2>Signals</h2>
          <div className="notyet">not yet: anchored tanker clusters, transit counts, hotspots and degree days arrive at level 17 (milestone 4).</div>
        </div>
      </div>
    </div>
  );
}
