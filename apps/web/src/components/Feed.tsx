import { formatClock } from "@desk/engine";
import { useGame } from "../store";

export function Feed({ max = 40, kinds }: { max?: number; kinds?: string[] }) {
  const feed = useGame((g) => g.feed);
  const state = useGame((g) => g.state);
  const rows = feed.filter((f) => !kinds || kinds.includes(f.kind)).slice(-max).reverse();
  if (!rows.length) return <div className="notyet">not yet: nothing has happened</div>;
  return (
    <div className="feed" role="log" aria-live="polite">
      {rows.map((f) => <div key={f.id} className={`row ${f.kind}`}><span className="t">{state ? formatClock(state.startDay, f.tick).slice(4) : f.tick}</span><span>{f.text}</span></div>)}
    </div>
  );
}
