/**
 * A small window hook for the end-to-end tests and the screenshot script: read the drills' answers, or put the app
 * into a known state (a level, a seed, a tick, with the solution bot's actions so screens have content).
 */
import { getLevel, makeRng, newGame, tick, type LogEntry } from "@desk/engine";
import { useGame } from "./store";

export function installHarness(): void {
  (window as unknown as { __desk: unknown }).__desk = {
    drills: () => (useGame.getState().state?.level.drills ?? []).map((d) => ({ id: d.id, answer: d.answer })),
    demo: (level: number, seed: number, untilTick: number) => {
      const spec = getLevel(level);
      const rng = makeRng(seed);
      let s = newGame(spec, seed);
      const log: LogEntry[] = [];
      while (s.tick < untilTick && s.level.status === "running") {
        const actions = spec.solve(s);
        if (actions.length) log.push({ tick: s.tick, actions });
        s = tick(s, actions, rng).state;
      }
      useGame.setState({ state: s, seed, log, speed: 0, pauseReason: "demo", feed: [], cardQueue: [], selected: { inst: spec.instruments[0], month: s.listed[spec.instruments[0]][0] } });
    },
    state: () => useGame.getState().state,
  };
}
