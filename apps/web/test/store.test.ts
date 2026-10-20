import { describe, expect, it, beforeEach } from "vitest";
import { getLevel, hasLevel } from "@desk/engine";
import { LEVELS, SANDBOX_ID_BASE } from "@desk/content";
import { useGame } from "../src/store";
import { allProgress, ordinal, parseRun, putRun, rankAmong, runsForLevel } from "../src/persistence";

/** step() pauses on every pausing event; run the clock until the level ends. */
function runToEnd(): void {
  for (let i = 0; i < 400 && useGame.getState().state!.level.status === "running"; i++) useGame.getState().step(40);
}

describe("the sandbox", () => {
  beforeEach(() => { useGame.setState({ state: null, sandbox: null, progress: {}, cumulativeScore: 0, lastRunId: null }); });
  it("starts a registered sandbox spec from a base level and knobs, with a fresh seed, and says Sandbox in its title", () => {
    useGame.getState().startSandbox(0, { days: 2, lives: 5, regime: "crisis", noEvents: true }, 42);
    const g = useGame.getState();
    expect(g.state!.level.id).toBe(SANDBOX_ID_BASE);
    expect(g.state!.level.title).toMatch(/^Sandbox:/);
    expect(g.seed).toBe(42);
    expect(g.sandbox).toEqual({ base: 0, knobs: { days: 2, lives: 5, regime: "crisis", noEvents: true } });
    expect(hasLevel(SANDBOX_ID_BASE)).toBe(true);
    expect(getLevel(SANDBOX_ID_BASE).lives).toBe(5);
    expect(g.state!.risk.lives).toBe(5);
    expect(g.state!.level.endTick).toBe(48);
  });
  it("exports the knobs with the run and imports them back by re-registering the spec before the replay", () => {
    useGame.getState().startSandbox(1, { capital: 7e6, limitScale: 2 }, 7);
    useGame.getState().step(30);
    const json = useGame.getState().exportCurrent()!;
    const parsed = parseRun(json);
    expect(parsed.sandbox).toEqual({ base: 1, knobs: { capital: 7e6, limitScale: 2 } });
    const before = JSON.stringify(useGame.getState().state);
    useGame.setState({ state: null, sandbox: null });
    useGame.getState().importRun(json);
    const g = useGame.getState();
    expect(g.sandbox).toEqual({ base: 1, knobs: { capital: 7e6, limitScale: 2 } });
    expect(g.state!.level.id).toBe(SANDBOX_ID_BASE + 1);
    expect(g.state!.capital).toBe(7e6);
    expect(g.state!.risk.limits.var95).toBe(LEVELS[1].limits.var95 * 2);
    expect(JSON.stringify(g.state)).toBe(before);
  });
  it("records nothing in progress or on the leaderboard when a sandbox run ends", async () => {
    useGame.getState().startSandbox(0, { days: 1 }, 3);
    runToEnd();
    const g = useGame.getState();
    expect(g.state!.level.status).not.toBe("running");
    expect(Object.keys(g.progress)).toEqual([]);
    expect(g.cumulativeScore).toBe(0);
    expect(await runsForLevel(SANDBOX_ID_BASE)).toEqual([]);
    expect((await allProgress()).some((p) => p.level >= SANDBOX_ID_BASE)).toBe(false);
  });
});

describe("the leaderboard", () => {
  it("writes one row per finished real level, once, and ranks a score among the others", async () => {
    useGame.setState({ state: null, sandbox: null, progress: {}, cumulativeScore: 0, lastRunId: null });
    useGame.getState().startLevel(0, 5);
    runToEnd();
    let g = useGame.getState();
    expect(g.state!.level.status).toMatch(/passed|failed/);
    expect(g.progress[0].attempts).toBe(1);
    // a click after the end (opening a card) does not count another attempt or another row
    useGame.getState().submit({ type: "open_card", player: "p1", cardId: LEVELS[0].cards[0].id });
    g = useGame.getState();
    expect(g.progress[0].attempts).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    const rows = await runsForLevel(0);
    expect(rows.length).toBe(1);
    expect(rows[0].seed).toBe(5);
    expect(rows[0].score).toBeCloseTo(g.state!.level.score!.total, 6);
    expect(useGame.getState().lastRunId).toBe(rows[0].id);
    await putRun({ level: 0, seed: 9, pnl: 1, score: rows[0].score + 50, passed: true, ticks: 24, finishedAt: 1 });
    await putRun({ level: 0, seed: 10, pnl: -1, score: rows[0].score - 50, passed: false, ticks: 24, finishedAt: 2 });
    const all = await runsForLevel(0);
    expect(all.map((r) => r.seed)).toEqual([9, 5, 10]); // best first
    const r = rankAmong(rows[0].score, all.filter((x) => x.id !== rows[0].id));
    expect(r).toEqual({ rank: 2, of: 3 });
    expect(`${ordinal(r.rank)} of ${r.of}`).toBe("2nd of 3");
    expect([1, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(["1st", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]);
  });
});
