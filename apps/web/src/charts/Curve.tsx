/** A forward curve: price by delivery month, hand-drawn SVG. */
import { monthLabel } from "@desk/engine";

export interface CurvePoint { month: string; mid: number; settle: number | null; bid: number; ask: number }
export function Curve({ points, unit, decimals, colour = "var(--crude)", height = 200 }: { points: CurvePoint[]; unit: string; decimals: number; colour?: string; height?: number }) {
  if (!points.length) return <div className="notyet">not yet: no listed months</div>;
  const w = 640, h = height, padL = 54, padR = 12, padT = 12, padB = 28;
  const ys = points.flatMap((p) => [p.mid, p.settle ?? p.mid]);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const span = Math.max(hi - lo, Math.abs(hi) * 0.01 || 0.1);
  lo -= span * 0.15; hi += span * 0.15;
  const x = (i: number) => padL + (i * (w - padL - padR)) / Math.max(1, points.length - 1);
  const y = (v: number) => padT + ((hi - v) * (h - padT - padB)) / (hi - lo);
  const d = points.map((p, i) => `${i ? "L" : "M"} ${x(i)} ${y(p.mid)}`).join(" ");
  const ds = points.every((p) => p.settle !== null) ? points.map((p, i) => `${i ? "L" : "M"} ${x(i)} ${y(p.settle!)}`).join(" ") : null;
  const ticks = 4;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={`Forward curve from ${monthLabel(points[0].month)} at ${points[0].mid.toFixed(decimals)} to ${monthLabel(points[points.length - 1].month)} at ${points[points.length - 1].mid.toFixed(decimals)} ${unit}`}>
      {Array.from({ length: ticks + 1 }, (_, i) => lo + ((hi - lo) * i) / ticks).map((v) => (
        <g key={v}><line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={padL - 6} y={y(v) + 4} textAnchor="end" fill="var(--dim)" fontSize="10" fontFamily="var(--mono)">{v.toFixed(decimals)}</text></g>
      ))}
      {ds && <path d={ds} stroke="var(--dim)" strokeWidth="1.5" fill="none" strokeDasharray="4 3" />}
      <path d={d} stroke={colour} strokeWidth="2" fill="none" />
      {points.map((p, i) => (
        <g key={p.month}>
          <circle cx={x(i)} cy={y(p.mid)} r="3" fill={colour} />
          {(i % 2 === 0 || points.length <= 6) && <text x={x(i)} y={h - 8} textAnchor="middle" fill="var(--dim)" fontSize="10">{monthLabel(p.month)}</text>}
        </g>
      ))}
      <text x={w - padR} y={padT + 10} textAnchor="end" fill="var(--dim)" fontSize="10">{unit}{ds ? " (dashed: last settle)" : ""}</text>
    </svg>
  );
}
