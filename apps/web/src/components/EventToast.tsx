import { useEffect, useState } from "react";
import { useGame } from "../store";

/** The last auto-pause reason, with a way to continue; a red vignette on a lost life; a burst on a passed level. */
export function EventToast() {
  const pauseReason = useGame((g) => g.pauseReason);
  const feed = useGame((g) => g.feed);
  const state = useGame((g) => g.state);
  const setSpeed = useGame((g) => g.setSpeed);
  const [flash, setFlash] = useState<{ kind: "life" | "pass"; id: number } | null>(null);
  const last = feed[feed.length - 1];
  useEffect(() => {
    if (!last) return;
    if (last.kind === "life_lost" || last.kind === "liquidation") setFlash({ kind: "life", id: last.id });
    if (last.kind === "level_passed") setFlash({ kind: "pass", id: last.id });
  }, [last?.id]);
  const important = [...feed].reverse().find((f) => ["event", "release", "margin_call", "limit_warning", "forced_reduction", "life_lost", "liquidation", "expiry", "level_ended", "level_passed", "level_failed", "news"].includes(f.kind));
  const show = pauseReason && state && pauseReason !== "paused" && pauseReason !== "briefing" && pauseReason !== "resumed";
  return (
    <>
      {flash?.kind === "life" && <div key={flash.id} className="vignette" aria-hidden="true" />}
      {flash?.kind === "pass" && <div key={flash.id} className="burst" aria-hidden="true" />}
      {show && (
        <div className="panel accent-crude" role="status" style={{ position: "fixed", right: 16, bottom: 16, width: "min(420px, calc(100% - 32px))", zIndex: 80 }}>
          <div className="muted small">clock paused</div>
          <div style={{ margin: "4px 0 8px" }}>{important && important.text.length > pauseReason.length ? important.text : pauseReason}</div>
          <div className="flex">
            {state.level.status === "running" ? <button className="primary" onClick={() => setSpeed(1)}>Continue (space)</button> : <a href="#/debrief"><button className="primary">Open the debrief</button></a>}
          </div>
        </div>
      )}
    </>
  );
}
