import { useState } from "react";
import { parseNumber } from "@desk/content";
import { useGame } from "../store";

export function Drills() {
  const state = useGame((g) => g.state);
  const submit = useGame((g) => g.submit);
  const feed = useGame((g) => g.feed);
  const [text, setText] = useState<Record<string, string>>({});
  const [err, setErr] = useState<Record<string, string>>({});
  if (!state || !state.level.drills.length) return null;
  const right = state.level.drills.filter((d) => d.correct).length;
  return (
    <div className="panel accent-mentor" id="drills">
      <h2>Conversion drills</h2>
      <div className="muted small">{right} of {state.level.drills.length} right. Every constant you need is in the question; a wrong answer may be retried.</div>
      {state.level.drills.map((d) => {
        const last = [...feed].reverse().find((f) => f.kind === "drill" && f.data?.drillId === d.id);
        return (
          <div className="drill" key={d.id}>
            <div>{d.prompt}</div>
            {d.correct ? <div className="pos small">Right: {d.working}</div> : (
              <form onSubmit={(e) => { e.preventDefault(); const v = parseNumber(text[d.id]); if (v === null) { setErr({ ...err, [d.id]: "type a number" }); return; } setErr({ ...err, [d.id]: "" }); submit({ type: "answer_drill", player: "p1", drillId: d.id, answer: v }); }}>
                <input aria-label={`answer in ${d.unit || "units"}`} value={text[d.id] ?? ""} onChange={(e) => setText({ ...text, [d.id]: e.target.value })} placeholder={d.unit} />
                <button type="submit">Check</button>
                {err[d.id] && <span className="refusal">{err[d.id]}</span>}
                {last && d.given !== undefined && !d.correct && <span className="neg small">{last.text}</span>}
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}
