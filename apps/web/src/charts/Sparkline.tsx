/** A small hand-drawn SVG sparkline: a series of readings with an optional baseline, for a table cell or a card line. */
export function Sparkline({ points, baseline, colour = "var(--crude)", width = 160, height = 36, label, format }: { points: number[]; baseline?: number; colour?: string; width?: number; height?: number; label: string; format?: (v: number) => string }) {
  if (points.length < 2) return <span className="notyet small">not yet: fewer than two points</span>;
  const all = baseline !== undefined ? [...points, baseline] : points;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const pad = 3;
  const x = (i: number) => pad + (i * (width - 2 * pad)) / (points.length - 1);
  const y = (v: number) => pad + ((hi - v) * (height - 2 * pad)) / (hi - lo);
  const d = points.map((v, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const fmt = format ?? ((v: number) => String(Math.round(v * 100) / 100));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`${label}: ${points.length} points from ${fmt(points[0])} to ${fmt(last)}${baseline !== undefined ? `, baseline ${fmt(baseline)}` : ""}`} style={{ verticalAlign: "middle" }}>
      {baseline !== undefined && <line x1={pad} x2={width - pad} y1={y(baseline)} y2={y(baseline)} stroke="var(--dim)" strokeDasharray="2 3" />}
      {baseline === undefined && lo < 0 && hi > 0 && <line x1={pad} x2={width - pad} y1={y(0)} y2={y(0)} stroke="var(--line)" />}
      <path d={d} stroke={colour} strokeWidth="1.5" fill="none" />
      <circle cx={x(points.length - 1)} cy={y(last)} r="2" fill={colour} />
    </svg>
  );
}
