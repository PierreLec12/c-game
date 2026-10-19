/** Small SVG diagrams for the concept cards. */
import type { Diagram as Kind } from "@desk/content";

export function Diagram({ kind }: { kind: Kind }) {
  switch (kind) {
    case "bidask": return (
      <svg viewBox="0 0 300 80" width="100%" role="img" aria-label="bid below mid below ask">
        <line x1="20" x2="280" y1="40" y2="40" stroke="var(--line)" />
        <circle cx="90" cy="40" r="6" fill="var(--cash)" /><text x="90" y="66" textAnchor="middle" fill="var(--text)" fontSize="11">bid: sell here</text>
        <circle cx="150" cy="40" r="4" fill="var(--dim)" /><text x="150" y="26" textAnchor="middle" fill="var(--muted)" fontSize="11">mid</text>
        <circle cx="210" cy="40" r="6" fill="var(--risk)" /><text x="210" y="66" textAnchor="middle" fill="var(--text)" fontSize="11">ask: buy here</text>
        <path d="M 95 50 Q 150 70 205 50" stroke="var(--crude)" fill="none" /><text x="150" y="78" textAnchor="middle" fill="var(--crude)" fontSize="10">the spread</text>
      </svg>);
    case "curve_contango": return (
      <svg viewBox="0 0 300 90" width="100%" role="img" aria-label="a curve rising with later months, capped by full carry">
        <path d="M 20 70 Q 150 40 280 30" stroke="var(--crude)" strokeWidth="2" fill="none" />
        <line x1="20" x2="280" y1="22" y2="22" stroke="var(--risk)" strokeDasharray="4 3" /><text x="278" y="18" textAnchor="end" fill="var(--risk)" fontSize="10">full carry</text>
        <text x="20" y="85" fill="var(--muted)" fontSize="10">front</text><text x="280" y="85" textAnchor="end" fill="var(--muted)" fontSize="10">12th month</text>
        <text x="150" y="80" textAnchor="middle" fill="var(--text)" fontSize="11">contango: later is dearer</text>
      </svg>);
    case "curve_backwardation": return (
      <svg viewBox="0 0 300 90" width="100%" role="img" aria-label="a curve falling with later months">
        <path d="M 20 25 Q 150 55 280 65" stroke="var(--crude)" strokeWidth="2" fill="none" />
        <text x="20" y="85" fill="var(--muted)" fontSize="10">front</text><text x="280" y="85" textAnchor="end" fill="var(--muted)" fontSize="10">12th month</text>
        <text x="150" y="80" textAnchor="middle" fill="var(--text)" fontSize="11">backwardation: prompt is dearer</text>
      </svg>);
    case "margin": return (
      <svg viewBox="0 0 300 90" width="100%" role="img" aria-label="initial margin held, variation margin flowing daily">
        <rect x="20" y="20" width="90" height="50" fill="var(--navy-3)" stroke="var(--gas)" /><text x="65" y="50" textAnchor="middle" fill="var(--text)" fontSize="11">your cash</text>
        <rect x="190" y="20" width="90" height="50" fill="var(--navy-3)" stroke="var(--crude)" /><text x="235" y="44" textAnchor="middle" fill="var(--text)" fontSize="11">clearer</text><text x="235" y="58" textAnchor="middle" fill="var(--muted)" fontSize="9">initial margin held</text>
        <path d="M 110 35 L 190 35" stroke="var(--crude)" markerEnd="url(#a)" /><text x="150" y="30" textAnchor="middle" fill="var(--crude)" fontSize="9">IM on open</text>
        <path d="M 190 58 L 110 58" stroke="var(--cash)" /><path d="M 110 58 L 190 58" stroke="var(--risk)" strokeDasharray="3 3" /><text x="150" y="72" textAnchor="middle" fill="var(--muted)" fontSize="9">VM each settle, either way</text>
      </svg>);
    case "timeline": return (
      <svg viewBox="0 0 300 70" width="100%" role="img" aria-label="roll before expiry">
        <line x1="20" x2="280" y1="35" y2="35" stroke="var(--line)" />
        <rect x="20" y="25" width="120" height="20" fill="var(--crude)" opacity="0.5" /><text x="80" y="20" textAnchor="middle" fill="var(--text)" fontSize="10">long M1</text>
        <line x1="150" x2="150" y1="15" y2="55" stroke="var(--risk)" /><text x="150" y="65" textAnchor="middle" fill="var(--risk)" fontSize="10">expiry</text>
        <rect x="130" y="25" width="150" height="20" fill="var(--teal)" opacity="0.5" /><text x="215" y="20" textAnchor="middle" fill="var(--text)" fontSize="10">long M2 (rolled before expiry)</text>
      </svg>);
    case "spread": return (
      <svg viewBox="0 0 300 80" width="100%" role="img" aria-label="long one leg short another; the gap is the position">
        <rect x="40" y="20" width="60" height="40" fill="var(--cash)" opacity="0.6" /><text x="70" y="72" textAnchor="middle" fill="var(--text)" fontSize="10">long leg</text>
        <rect x="200" y="20" width="60" height="40" fill="var(--risk)" opacity="0.6" /><text x="230" y="72" textAnchor="middle" fill="var(--text)" fontSize="10">short leg</text>
        <path d="M 100 40 L 200 40" stroke="var(--crude)" strokeWidth="2" /><text x="150" y="34" textAnchor="middle" fill="var(--crude)" fontSize="10">the gap is the position</text>
      </svg>);
    case "crack": return (
      <svg viewBox="0 0 300 80" width="100%" role="img" aria-label="three crude into two gasoline and one diesel">
        <rect x="20" y="15" width="70" height="50" fill="var(--crude)" opacity="0.7" /><text x="55" y="45" textAnchor="middle" fill="#1a1200" fontSize="11">3 crude</text>
        <path d="M 95 40 L 125 40" stroke="var(--muted)" /><text x="110" y="32" textAnchor="middle" fill="var(--muted)" fontSize="9">refinery</text>
        <rect x="130" y="15" width="60" height="30" fill="var(--products)" opacity="0.7" /><text x="160" y="35" textAnchor="middle" fill="#2a0020" fontSize="10">2 gasoline</text>
        <rect x="130" y="50" width="60" height="15" fill="var(--teal)" opacity="0.7" /><text x="160" y="61" textAnchor="middle" fill="#002a26" fontSize="9">1 diesel</text>
        <text x="245" y="42" textAnchor="middle" fill="var(--text)" fontSize="11">crack = margin</text>
      </svg>);
    case "release": return (
      <svg viewBox="0 0 300 80" width="100%" role="img" aria-label="price steady until the print, then a jump by the surprise">
        <path d="M 20 40 L 150 42 L 150 20 L 280 22" stroke="var(--crude)" strokeWidth="2" fill="none" />
        <line x1="150" x2="150" y1="10" y2="70" stroke="var(--dim)" strokeDasharray="3 3" /><text x="150" y="78" textAnchor="middle" fill="var(--muted)" fontSize="10">15:00 print</text>
        <text x="215" y="14" textAnchor="middle" fill="var(--text)" fontSize="10">jump = the surprise</text>
        <text x="85" y="58" textAnchor="middle" fill="var(--muted)" fontSize="10">consensus already priced</text>
      </svg>);
    default: return null;
  }
}
