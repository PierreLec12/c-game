/**
 * Saves live in IndexedDB: { seed, level, log, tick, state } per slot (one slot per level), plus level progress and,
 * since milestone 5, one "runs" row per finished real level (the leaderboard against the player's own past runs).
 * A sandbox save also carries { base, knobs } so the spec can be rebuilt and registered before the state is resumed or replayed.
 * Exportable and importable as JSON so a run can be sent to someone or attached to a bug report.
 */
import { openDB, type IDBPDatabase } from "idb";
import type { LogEntry, State } from "@desk/engine";
import type { SandboxKnobs } from "@desk/content";

export interface SandboxRef { base: number; knobs: SandboxKnobs }
export interface Save { level: number; seed: number; log: LogEntry[]; tick: number; state: State; savedAt: number; sandbox?: SandboxRef }
export interface Progress { level: number; bestScore: number; passed: boolean; attempts: number; lastSeed: number; cumulative?: number }
/** One finished run of a real level: what the leaderboard ranks. `id` is assigned by the store. */
export interface RunRow { id?: number; level: number; seed: number; pnl: number; score: number; passed: boolean; ticks: number; finishedAt: number }

const DB = "desk";
const VERSION = 2;
let dbp: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB, VERSION, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          d.createObjectStore("saves", { keyPath: "level" });
          d.createObjectStore("progress", { keyPath: "level" });
          d.createObjectStore("prefs");
        }
        if (oldVersion < 2) {
          const runs = d.createObjectStore("runs", { keyPath: "id", autoIncrement: true });
          runs.createIndex("level", "level");
        }
      },
    });
  }
  return dbp;
}

export async function putSave(save: Save): Promise<void> { (await db()).put("saves", save); }
export async function getSave(level: number): Promise<Save | undefined> { return (await db()).get("saves", level); }
export async function deleteSave(level: number): Promise<void> { (await db()).delete("saves", level); }
export async function allSaves(): Promise<Save[]> { return (await db()).getAll("saves"); }
export async function putProgress(p: Progress): Promise<void> { (await db()).put("progress", p); }
export async function allProgress(): Promise<Progress[]> { return (await db()).getAll("progress"); }
export async function getPref<T>(key: string): Promise<T | undefined> { return (await db()).get("prefs", key); }
export async function setPref<T>(key: string, value: T): Promise<void> { (await db()).put("prefs", value, key); }
/** Appends a finished run and returns its id. */
export async function putRun(row: RunRow): Promise<number> { return Number(await (await db()).add("runs", row)); }
/** Every finished run of a level, best score first (ties: most recent first). */
export async function runsForLevel(level: number): Promise<RunRow[]> {
  const rows: RunRow[] = await (await db()).getAllFromIndex("runs", "level", level);
  return rows.sort((a, b) => b.score - a.score || b.finishedAt - a.finishedAt);
}

/** Ordinal rank of a score among rows: "2nd of 5". Ties share the better rank. */
export function rankAmong(score: number, others: RunRow[]): { rank: number; of: number } {
  return { rank: 1 + others.filter((r) => r.score > score).length, of: others.length + 1 };
}
export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function exportRun(save: Save): string {
  return JSON.stringify({ format: "desk-run-1", level: save.level, seed: save.seed, tick: save.tick, log: save.log, state: save.state, ...(save.sandbox ? { sandbox: save.sandbox } : {}) }, null, 0);
}
export function parseRun(json: string): Save {
  const o = JSON.parse(json);
  if (o.format !== "desk-run-1" || typeof o.level !== "number" || typeof o.seed !== "number" || !Array.isArray(o.log)) throw new Error("not a DESK run file");
  const sandbox: SandboxRef | undefined = o.sandbox && typeof o.sandbox.base === "number" && o.sandbox.knobs && typeof o.sandbox.knobs === "object" ? { base: o.sandbox.base, knobs: o.sandbox.knobs } : undefined;
  return { level: o.level, seed: o.seed, log: o.log, tick: o.tick ?? o.state?.tick ?? 0, state: o.state, savedAt: Date.now(), ...(sandbox ? { sandbox } : {}) };
}
