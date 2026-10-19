/** A time line chart: equity, P&L or price over ticks, with optional markers and a ghost series. */
import { formatClock } from "@desk/engine";

export interface Series { name: string; points: { tick: number; v: number }[]; colour: string; dashed?: boolean }
export interface Marker { tick: number; label: string; colour?: string }
export function Line({ series, markers = [], startDay, height = 180, format }: { series: Series[]; markers?: Marker[]; startDay: number; height?: number; format: (v: number) => string }) {
  const all = series.flatMap((s) => s.points);
  if (all.length < 2) return <div className="notyet">not yet: fewer than two points</div>;
  const w = 640, h = height, padL = 60, padR = 12, padT = 10, padB = 24;
  const t0 = Math.min(...all.map((p) => p.tick)), t1 = Math.max(...all.map((p) => p.tick));
  let lo = Math.min(...all.map((p) => p.v)), hi = Math.max(...all.map((p) => p.v));
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const span = hi - lo; lo -= span * 0.1; hi += span * 0.1;
  const x = (t: number) => padL + ((t - t0) * (w - padL - padR)) / Math.max(1, t1 - t0);
  const y = (v: number) => padT + ((hi - v) * (h - padT - padB)) / (hi - lo);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={series.map((s) => `${s.name} from ${format(s.points[0].v)} to ${format(s.points[s.points.length - 1].v)}`).join("; ")}>
      {[0, 0.5, 1].map((f) => { const v = lo + (hi - lo) * f; return <g key={f}><line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={padL - 6} y={y(v) + 4} textAnchor="end" fill="var(--dim)" fontSize="10" fontFamily="var(--mono)">{format(v)}</text></g>; })}
      {lo < 0 && hi > 0 && <line x1={padL} x2={w - padR} y1={y(0)} y2={y(0)} stroke="var(--dim)" strokeDasharray="2 3" />}
      {series.map((s) => <path key={s.name} d={s.points.map((p, i) => `${i ? "L" : "M"} ${x(p.tick)} ${y(p.v)}`).join(" ")} stroke={s.colour} strokeWidth={s.dashed ? 1.5 : 2} strokeDasharray={s.dashed ? "5 4" : undefined} fill="none" />)}
      {markers.map((m, i) => <g key={i}><line x1={x(m.tick)} x2={x(m.tick)} y1={padT} y2={h - padB} stroke={m.colour ?? "var(--muted)"} strokeDasharray="2 2" /><text x={x(m.tick) + 3} y={padT + 10 + (i % 3) * 11} fill={m.colour ?? "var(--muted)"} fontSize="9">{m.label}</text></g>)}
      <text x={padL} y={h - 6} fill="var(--dim)" fontSize="10">{formatClock(startDay, t0)}</text>
      <text x={w - padR} y={h - 6} textAnchor="end" fill="var(--dim)" fontSize="10">{formatClock(startDay, t1)}</text>
      <g>{series.map((s, i) => <text key={s.name} x={padL + 8 + i * 130} y={padT + 10} fill={s.colour} fontSize="10">{s.name}</text>)}</g>
    </svg>
  );
}
