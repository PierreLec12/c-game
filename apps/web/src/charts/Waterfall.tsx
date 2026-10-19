/** The attribution waterfall: one bar per leg, each with a sentence. */
import { Fig } from "../components/Fig";

export interface WaterfallRow { leg: string; label: string; amount: number; text: string }
export function Waterfall({ rows, total }: { rows: WaterfallRow[]; total: number }) {
  const shown = rows.filter((r) => Math.abs(r.amount) >= 1);
  if (!shown.length) return <div className="notyet">not yet: no settles or closed lots to attribute</div>;
  const w = 640, barH = 22, gap = 8, padL = 130, padR = 90;
  const h = (shown.length + 1) * (barH + gap) + 10;
  let run = 0;
  const ends = shown.map((r) => { const s = run; run += r.amount; return [s, run] as [number, number]; });
  const all = [0, ...ends.flat(), total];
  const lo = Math.min(...all), hi = Math.max(...all);
  const x = (v: number) => padL + ((v - lo) * (w - padL - padR)) / Math.max(1, hi - lo);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={`Attribution waterfall totalling ${Math.round(total).toLocaleString()} dollars`}>
        <line x1={x(0)} x2={x(0)} y1={0} y2={h} stroke="var(--line)" />
        {shown.map((r, i) => {
          const [a, b] = ends[i];
          const yy = i * (barH + gap) + 5;
          return (
            <g key={r.leg}>
              <text x={padL - 8} y={yy + barH / 2 + 4} textAnchor="end" fill="var(--muted)" fontSize="11">{r.label}</text>
              <rect x={Math.min(x(a), x(b))} y={yy} width={Math.max(2, Math.abs(x(b) - x(a)))} height={barH} fill={r.amount >= 0 ? "var(--cash)" : "var(--risk)"} rx="3" />
              <text x={w - padR + 6} y={yy + barH / 2 + 4} fill="var(--text)" fontSize="11" fontFamily="var(--mono)">{(r.amount < 0 ? "-$" : "$") + Math.abs(Math.round(r.amount)).toLocaleString()}</text>
            </g>
          );
        })}
        <g>
          <text x={padL - 8} y={shown.length * (barH + gap) + 5 + barH / 2 + 4} textAnchor="end" fill="var(--text)" fontSize="11" fontWeight="600">Book P&L</text>
          <rect x={Math.min(x(0), x(total))} y={shown.length * (barH + gap) + 5} width={Math.max(2, Math.abs(x(total) - x(0)))} height={barH} fill="var(--crude)" rx="3" />
          <text x={w - padR + 6} y={shown.length * (barH + gap) + 5 + barH / 2 + 4} fill="var(--text)" fontSize="11" fontFamily="var(--mono)" fontWeight="600">{(total < 0 ? "-$" : "$") + Math.abs(Math.round(total)).toLocaleString()}</text>
        </g>
      </svg>
      <table>
        <thead><tr><th>Leg</th><th className="num">USD</th><th>What moved</th></tr></thead>
        <tbody>{shown.map((r) => <tr key={r.leg}><td>{r.label}</td><td className="num"><Fig v={r.amount} fmt="usd" sign what={`${r.label} leg`} why={r.text} /></td><td className="small muted">{r.text}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
