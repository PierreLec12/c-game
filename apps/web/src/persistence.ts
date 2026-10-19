/**
 * Saves live in IndexedDB: { seed, level, log, tick, state } per slot (one slot per level), plus level progress.
 * Exportable and importable as JSON so a run can be sent to someone or attached to a bug report.
 */
import { openDB, type IDBPDatabase } from "idb";
import type { LogEntry, State } from "@desk/engine";

export interface Save { level: number; seed: number; log: LogEntry[]; tick: number; state: State; savedAt: number }
export interface Progress { level: number; bestScore: number; passed: boolean; attempts: number; lastSeed: number; cumulative?: number }

const DB = "desk";
let dbp: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB, 1, {
      upgrade(d) {
        d.createObjectStore("saves", { keyPath: "level" });
        d.createObjectStore("progress", { keyPath: "level" });
        d.createObjectStore("prefs");
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

export function exportRun(save: Save): string {
  return JSON.stringify({ format: "desk-run-1", level: save.level, seed: save.seed, tick: save.tick, log: save.log, state: save.state }, null, 0);
}
export function parseRun(json: string): Save {
  const o = JSON.parse(json);
  if (o.format !== "desk-run-1" || typeof o.level !== "number" || typeof o.seed !== "number" || !Array.isArray(o.log)) throw new Error("not a DESK run file");
  return { level: o.level, seed: o.seed, log: o.log, tick: o.tick ?? o.state?.tick ?? 0, state: o.state, savedAt: Date.now() };
}
