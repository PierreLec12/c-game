/**
 * UI state: the engine state, the clock, the action log, the event feed, saves. The engine is pure;
 * this store is the only place that holds a State and the only place that calls tick().
 */
import { create } from "zustand";
import { applyActions, getLevel, makeRng, newGame, nextEventTick, replay, tick, type Action, type EngineEvent, type LogEntry, type Refusal, type State } from "@desk/engine";
import { isSandboxId, LEVELS, sandboxSpec, type SandboxKnobs } from "@desk/content";
import { allProgress, deleteSave, getSave, parseRun, putProgress, putRun, putSave, type Progress, type RunRow, type SandboxRef, type Save } from "./persistence";

export type Speed = 0 | 1 | 4 | 12 | "next";
/** Ticks per real second at each speed: 1x is one tick per two seconds (section 3.3); "next" runs flat out to the next pause. */
export const TICKS_PER_SECOND: Record<Exclude<Speed, "next">, number> = { 0: 0, 1: 0.5, 4: 2, 12: 6 };
export const MAX_TICKS_PER_FRAME = 40;

export interface FeedItem { id: number; tick: number; kind: EngineEvent["kind"]; text: string; data?: Record<string, unknown> }

interface GameStore {
  state: State | null;
  seed: number;
  log: LogEntry[];
  speed: Speed;
  feed: FeedItem[];
  refusals: (Refusal & { id: number })[];
  pauseReason: string | null;
  cardQueue: string[];
  progress: Record<number, Progress>;
  lastTickMs: number;
  tickCount: number;
  cumulativeScore: number;
  selected: { inst: string; month: string } | null;
  /** The sandbox this run was built from (null for a real level); travels with the save so the spec can be rebuilt. */
  sandbox: SandboxRef | null;
  /** The id of this run's row in the "runs" store once it is recorded (the Debrief ranks it against the others). */
  lastRunId: number | null;
  startLevel: (level: number, seed?: number) => void;
  startSandbox: (base: number, knobs: SandboxKnobs, seed?: number) => void;
  resumeLevel: (level: number) => Promise<boolean>;
  submit: (a: Action) => Refusal | null;
  setSpeed: (s: Speed) => void;
  togglePause: () => void;
  step: (n: number) => void;
  dismissCard: () => void;
  openCard: (id: string) => void;
  loadProgress: () => Promise<void>;
  exportCurrent: () => string | null;
  importRun: (json: string) => void;
  select: (inst: string, month: string) => void;
  restart: () => void;
  /** Records the current run if it is finished (what submit and step do on their own; the harness calls it after a demo). */
  recordRun: () => void;
}

let feedId = 0;
let rng = makeRng(1);
/** The run already written to progress and the leaderboard, so a click after the end does not count a second attempt. */
let recordedKey: string | null = null;

/** A fresh seed for a level that wants one every run: time-derived, nine digits, so it reads and types back. */
export function freshSeed(): number { return (Date.now() % 1_000_000_000) || 1; }

function pushFeed(feed: FeedItem[], events: EngineEvent[]): FeedItem[] {
  const items = events.map((e) => ({ id: ++feedId, tick: e.tick, kind: e.kind, text: e.text, data: e.data }));
  return [...feed, ...items].slice(-400);
}

async function persist(get: () => GameStore): Promise<void> {
  const { state, seed, log, sandbox } = get();
  if (!state) return;
  const save: Save = { level: state.level.id, seed, log, tick: state.tick, state, savedAt: Date.now(), ...(sandbox ? { sandbox } : {}) };
  await putSave(save);
}

function recordScore(get: () => GameStore, set: (p: Partial<GameStore>) => void): void {
  const { state, progress, seed } = get();
  if (!state || !state.level.score) return;
  const final = state.level.status === "passed" || state.level.status === "failed";
  if (!final) return;
  const key = `${state.level.id}:${seed}:${state.level.endedTick ?? state.tick}`;
  if (recordedKey === key) return;
  recordedKey = key;
  void deleteSave(state.level.id);
  // a sandbox run leaves no trace: no progress, no rank, no leaderboard row
  if (isSandboxId(state.level.id)) return;
  const prev = progress[state.level.id];
  const p: Progress = { level: state.level.id, bestScore: Math.max(prev?.bestScore ?? -Infinity, state.level.score.total), passed: (prev?.passed ?? false) || state.level.status === "passed", attempts: (prev?.attempts ?? 0) + 1, lastSeed: seed };
  const next = { ...progress, [state.level.id]: p };
  set({ progress: next, cumulativeScore: cumulativeOf(Object.values(next)) });
  void putProgress(p);
  const row: RunRow = { level: state.level.id, seed, pnl: state.pnl.total, score: state.level.score.total, passed: state.level.status === "passed", ticks: state.level.endedTick ?? state.tick, finishedAt: Date.now() };
  void putRun(row).then((id) => set({ lastRunId: id }));
}

function cumulativeOf(rows: Progress[]): number {
  return rows.filter((x) => !isSandboxId(x.level)).reduce((a, x) => a + Math.max(0, x.bestScore), 0);
}

function begin(set: (p: Partial<GameStore>) => void, get: () => GameStore, levelId: number, s: number, sandbox: SandboxRef | null): void {
  const spec = getLevel(levelId);
  rng = makeRng(s);
  const state = newGame(spec, s);
  const initial = applyActions(state, [], rng); // no-op; keeps the feed shape
  const title = sandbox ? `${spec.title} on seed ${s}` : `Level ${levelId}: ${spec.title}`;
  set({ state: initial.state, seed: s, log: [], speed: 0, feed: pushFeed([], [{ kind: "mentor", tick: 0, text: `${title}. ${spec.briefing.split("\n")[0]}` }]), refusals: [], pauseReason: "briefing", cardQueue: [], selected: { inst: spec.instruments[0], month: state.listed[spec.instruments[0]][0] }, sandbox, lastRunId: null });
  // cards that unlock at tick 0 and the mentor's first line arrive on the first tick
  void persist(get);
}

export const useGame = create<GameStore>((set, get) => ({
  state: null, seed: 1, log: [], speed: 0, feed: [], refusals: [], pauseReason: null, cardQueue: [], progress: {}, lastTickMs: 0, tickCount: 0, cumulativeScore: 0, selected: null, sandbox: null, lastRunId: null,
  startLevel(level, seed) {
    const spec = getLevel(level);
    // Partner wants a fresh seed every run; every other level rotates through its list by attempt
    const s = seed ?? (spec.freshSeed ? freshSeed() : spec.seeds[(get().progress[level]?.attempts ?? 0) % spec.seeds.length]);
    begin(set, get, level, s, null);
  },
  startSandbox(base, knobs, seed) {
    const spec = sandboxSpec(base, knobs);
    begin(set, get, spec.id, seed ?? freshSeed(), { base, knobs });
  },
  async resumeLevel(level) {
    const save = await getSave(level);
    if (!save) return false;
    if (save.sandbox) sandboxSpec(save.sandbox.base, save.sandbox.knobs); // the engine needs the spec registered before the next tick
    rng = makeRng(save.seed);
    set({ state: save.state, seed: save.seed, log: save.log, speed: 0, feed: [], refusals: [], pauseReason: "resumed", cardQueue: [], selected: { inst: save.state.level.instruments[0], month: save.state.listed[save.state.level.instruments[0]][0] }, sandbox: save.sandbox ?? null, lastRunId: null });
    return true;
  },
  submit(a) {
    const { state, log, feed } = get();
    if (!state) return null;
    const r = applyActions(state, [a], rng);
    if (r.refused.length) {
      set({ refusals: [...get().refusals, { ...r.refused[0], id: ++feedId }].slice(-20) });
      return r.refused[0];
    }
    const entry = log.length && log[log.length - 1].tick === state.tick ? { tick: state.tick, actions: [...log[log.length - 1].actions, a] } : { tick: state.tick, actions: [a] };
    const nextLog = log.length && log[log.length - 1].tick === state.tick ? [...log.slice(0, -1), entry] : [...log, entry];
    const cards = r.events.filter((e) => e.kind === "card").map((e) => String(e.data?.cardId));
    set({ state: r.state, log: nextLog, feed: pushFeed(feed, r.events), cardQueue: [...get().cardQueue, ...cards] });
    recordScore(get, set);
    void persist(get);
    return null;
  },
  setSpeed(speed) {
    set({ speed, pauseReason: speed === 0 ? get().pauseReason ?? "paused" : null });
  },
  togglePause() {
    const { speed } = get();
    if (speed === 0) set({ speed: 1, pauseReason: null });
    else set({ speed: 0, pauseReason: "paused" });
  },
  step(n) {
    const { state } = get();
    if (!state || state.level.status !== "running") { set({ speed: 0 }); return; }
    let s = state;
    let feed = get().feed;
    const cards: string[] = [];
    let pause: string | null = null;
    let count = 0;
    const t0 = performance.now();
    const untilNext = get().speed === "next" ? nextEventTick(s) : null;
    for (let i = 0; i < n; i++) {
      const r = tick(s, [], rng);
      s = r.state;
      count += 1;
      if (r.events.length) {
        feed = pushFeed(feed, r.events);
        for (const e of r.events) if (e.kind === "card") cards.push(String(e.data?.cardId));
        const p = r.events.find((e) => e.pause);
        if (p) { pause = p.text; break; }
      }
      if (s.level.status !== "running") { pause = "level ended"; break; }
      if (untilNext !== null && s.tick >= untilNext) { pause = "next event"; break; }
    }
    const ms = (performance.now() - t0) / Math.max(1, count);
    set({ state: s, feed, cardQueue: [...get().cardQueue, ...cards], lastTickMs: ms, tickCount: get().tickCount + count, ...(pause ? { speed: 0 as Speed, pauseReason: pause } : {}) });
    if (pause || s.tick % 24 === 0) void persist(get);
    recordScore(get, set);
  },
  dismissCard() { set({ cardQueue: get().cardQueue.slice(1) }); },
  openCard(id) {
    const { state } = get();
    if (state && !state.level.cardsOpened.includes(id)) get().submit({ type: "open_card", player: "p1", cardId: id });
  },
  async loadProgress() {
    const rows = (await allProgress()).filter((r) => !isSandboxId(r.level));
    const progress: Record<number, Progress> = {};
    for (const r of rows) progress[r.level] = r;
    set({ progress, cumulativeScore: cumulativeOf(rows) });
  },
  exportCurrent() {
    const { state, seed, log, sandbox } = get();
    if (!state) return null;
    return JSON.stringify({ format: "desk-run-1", level: state.level.id, seed, tick: state.tick, log, state, ...(sandbox ? { sandbox } : {}) });
  },
  importRun(json) {
    const save = parseRun(json);
    if (save.sandbox) sandboxSpec(save.sandbox.base, save.sandbox.knobs); // register before replay looks the level up
    const state = replay(save.seed, save.level, save.log, save.tick);
    rng = makeRng(save.seed);
    set({ state, seed: save.seed, log: save.log, speed: 0, feed: [], refusals: [], pauseReason: "imported run replayed from its seed and log", cardQueue: [], selected: { inst: state.level.instruments[0], month: state.listed[state.level.instruments[0]][0] }, sandbox: save.sandbox ?? null, lastRunId: null });
  },
  select(inst, month) { set({ selected: { inst, month } }); },
  restart() {
    const { state, seed, sandbox } = get();
    if (!state) return;
    if (sandbox) get().startSandbox(sandbox.base, sandbox.knobs, seed);
    else get().startLevel(state.level.id, seed);
  },
  recordRun() { recordScore(get, set); },
}));

export const LEVEL_LIST = LEVELS;
