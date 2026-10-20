import type { RunRow } from "../persistence";

const usd = (x: number) => (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString();
const when = (t: number) => new Date(t).toLocaleDateString(undefined, { year: "2-digit", month: "short", day: "numeric" }) + " " + new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** The finished runs of one level, best score first: the leaderboard against the player's own past runs. */
export function PastRuns({ runs, highlight, max }: { runs: RunRow[]; highlight?: number | null; max?: number }) {
  if (!runs.length) return <div className="muted small">No finished run yet. A run is recorded when the level ends and the debrief questions are answered.</div>;
  const rows = max ? runs.slice(0, max) : runs;
  return (
    <div className="scroll-x" tabIndex={0} aria-label="past runs">
      <table className="runs">
        <thead><tr><th>#</th><th>Date</th><th className="num">Seed</th><th className="num">P&L</th><th className="num">Score</th><th>Result</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={r.id ?? i} className={highlight != null && r.id === highlight ? "selected" : ""}><td>{i + 1}</td><td>{when(r.finishedAt)}</td><td className="num">{r.seed}</td><td className={`num ${r.pnl < 0 ? "neg" : "pos"}`}>{usd(r.pnl)}</td><td className="num">{Math.round(r.score)}</td><td><span className={`badge ${r.passed ? "ok" : "warn"}`}>{r.passed ? "passed" : "not passed"}</span>{highlight != null && r.id === highlight ? <span className="badge">this run</span> : null}</td></tr>)}</tbody>
      </table>
      {max && runs.length > max ? <div className="small muted">and {runs.length - max} more in the Academy</div> : null}
    </div>
  );
}

