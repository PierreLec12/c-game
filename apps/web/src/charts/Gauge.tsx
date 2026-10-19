/** A risk gauge as an arc: value against limit, red past it. */
export function Gauge({ value, limit, name, format, colour = "var(--crude)" }: { value: number | null; limit: number; name: string; format: (x: number) => string; colour?: string }) {
  const share = value === null || limit <= 0 ? 0 : Math.min(1.2, value / limit);
  const r = 44, cx = 55, cy = 58;
  const a0 = Math.PI, a1 = Math.PI + Math.PI * Math.min(1, share);
  const arc = (from: number, to: number) => `M ${cx + r * Math.cos(from)} ${cy + r * Math.sin(from)} A ${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${cx + r * Math.cos(to)} ${cy + r * Math.sin(to)}`;
  const over = share > 1;
  return (
    <div className="gauge" role="img" aria-label={`${name}: ${value === null ? "not yet" : format(value)} of ${format(limit)}`}>
      <svg viewBox="0 0 110 70">
        <path d={arc(a0, 2 * Math.PI)} stroke="var(--navy-3)" strokeWidth="9" fill="none" />
        {share > 0 && <path d={arc(a0, a1)} stroke={over ? "var(--risk)" : colour} strokeWidth="9" fill="none" strokeLinecap="round" />}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="var(--text)" fontSize="13" fontFamily="var(--mono)">{value === null ? "not yet" : format(value)}</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="var(--dim)" fontSize="9">of {format(limit)}</text>
      </svg>
      <div className="name">{name}</div>
    </div>
  );
}
