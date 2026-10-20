import { describe, expect, it } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { newGame } from "@desk/engine";
import { LEVELS } from "@desk/content";
import { useGame } from "../src/store";
import { EventToast } from "../src/components/EventToast";

describe("the event toast", () => {
  it("shows the risk manager's sentence on a lost life and a rank card with score, rank and achievements on a passed level", () => {
    const state = newGame(LEVELS[0], 1, { par: 0 });
    useGame.setState({ state, seed: 1, feed: [], cardQueue: [], pauseReason: null, cumulativeScore: 0, sandbox: null });
    render(<MemoryRouter><EventToast /></MemoryRouter>);
    act(() => { useGame.setState({ feed: [{ id: 9001, tick: 5, kind: "life_lost", text: "VaR over the limit at three closes. A life: the book is flat." }, { id: 9002, tick: 5, kind: "liquidation", text: "Book flattened by the risk manager." }] }); });
    expect(screen.getByRole("status")).toHaveTextContent("VaR over the limit at three closes");
    expect(screen.getByRole("status")).toHaveTextContent("risk");
    const passed = { ...state, level: { ...state.level, status: "passed" as const, score: { pnl: 1200, par: 0, pnlComponent: 100, process: 1, processComponent: 50, maxDrawdown: 0, drawdownComponent: 0, quiz: 1, quizComponent: 25, total: 175, passed: true, formula: "", achievements: ["Round trip"] } } };
    act(() => { useGame.setState({ state: passed, cumulativeScore: 175, feed: [{ id: 9003, tick: 24, kind: "level_passed", text: "Level 0 passed with 175 points" }] }); });
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("175");
    expect(dialog).toHaveTextContent("Operator");
    expect(dialog).toHaveTextContent("Round trip");
    act(() => { screen.getByRole("button", { name: "Close" }).click(); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("shows no rank card for a sandbox run", () => {
    const state = newGame(LEVELS[0], 1, { par: 0 });
    const sandboxed = { ...state, level: { ...state.level, id: 100, status: "passed" as const, score: { pnl: 0, par: 0, pnlComponent: 100, process: 1, processComponent: 50, maxDrawdown: 0, drawdownComponent: 0, quiz: 1, quizComponent: 25, total: 175, passed: true, formula: "", achievements: [] } } };
    useGame.setState({ state: sandboxed, seed: 1, feed: [], cardQueue: [], pauseReason: null, sandbox: { base: 0, knobs: {} } });
    render(<MemoryRouter><EventToast /></MemoryRouter>);
    act(() => { useGame.setState({ feed: [{ id: 9101, tick: 24, kind: "level_passed", text: "Level 100 passed with 175 points" }] }); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
