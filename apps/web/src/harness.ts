/**
 * A small window hook for the end-to-end tests and the screenshot script: read the drills' answers, or put the app
 * into a known state (a level, a seed, a tick, with the solution bot's actions so screens have content).
 */
import { getLevel, makeRng, newGame, tick, type Action, type ActionType, type EventSchedule, type Grade, type InstrumentId, type LevelSpec, type LogEntry, type RiskLimits } from "@desk/engine";
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
      useGame.setState({ state: s, seed, log, speed: 0, pauseReason: null, feed: [], cardQueue: [], sandbox: null, lastRunId: null, selected: { inst: spec.instruments[0], month: s.listed[spec.instruments[0]][0] } });
    },
    state: () => useGame.getState().state,
    /** A level with extra instruments, unlocks, a refinery or signal events patched in: for exercising screens whose level is not registered yet. */
    lab: (level: number, seed: number, untilTick: number, patch: { instruments?: InstrumentId[]; unlocks?: ActionType[]; refinery?: { slate: Grade; runs: number }; events?: EventSchedule[]; limits?: Partial<RiskLimits> }) => {
      const base = getLevel(level);
      const spec: LevelSpec = { ...base, instruments: [...new Set([...base.instruments, ...(patch.instruments ?? [])])], unlocks: [...new Set([...base.unlocks, ...(patch.unlocks ?? [])])], refinery: patch.refinery ?? base.refinery, events: [...base.events, ...(patch.events ?? [])], limits: { ...base.limits, ...(patch.limits ?? {}) }, solve: () => [] };
      const rng = makeRng(seed);
      let s = newGame(spec, seed, { par: 0 });
      while (s.tick < untilTick && s.level.status === "running") s = tick(s, [], rng).state;
      useGame.setState({ state: s, seed, log: [], speed: 0, pauseReason: null, feed: [], cardQueue: [], sandbox: null, lastRunId: null, selected: { inst: spec.instruments[0], month: s.listed[spec.instruments[0]][0] } });
    },
    submit: (a: Action) => useGame.getState().submit(a),
    step: (n: number) => useGame.getState().step(n),
    /** Answers every open debrief question with its correct choice, so a demo run finishes, scores and is recorded on the leaderboard. */
    finish: () => {
      const g = useGame.getState();
      for (const q of g.state?.level.quiz ?? []) if (q.given === undefined) useGame.getState().submit({ type: "answer_quiz", player: "p1", questionId: q.id, choice: q.correct });
      useGame.getState().recordRun();
    },
    /** The store's performance counters: the last measured milliseconds per tick and the ticks stepped so far. */
    perf: () => ({ lastTickMs: useGame.getState().lastTickMs, tickCount: useGame.getState().tickCount }),
  };
}
