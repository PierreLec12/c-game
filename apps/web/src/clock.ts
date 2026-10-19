/**
 * The clock: requestAnimationFrame drives tick() the right number of times per frame. The engine never reads a wall clock.
 */
import { useEffect } from "react";
import { MAX_TICKS_PER_FRAME, TICKS_PER_SECOND, useGame } from "./store";

export function useClock(): void {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frame = (now: number) => {
      const { speed, state, step } = useGame.getState();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (state && state.level.status === "running" && speed !== 0) {
        if (speed === "next") step(MAX_TICKS_PER_FRAME);
        else {
          acc += dt * TICKS_PER_SECOND[speed];
          const n = Math.min(MAX_TICKS_PER_FRAME, Math.floor(acc));
          if (n > 0) { acc -= n; step(n); }
        }
      } else acc = 0;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
}

/** Keyboard: space pauses, 1/2/3 set speed, N jumps to the next event. */
export function useKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const g = useGame.getState();
      if (!g.state) return;
      if (e.key === " ") { e.preventDefault(); g.togglePause(); }
      else if (e.key === "1") g.setSpeed(1);
      else if (e.key === "2") g.setSpeed(4);
      else if (e.key === "3") g.setSpeed(12);
      else if (e.key.toLowerCase() === "n") g.setSpeed("next");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
