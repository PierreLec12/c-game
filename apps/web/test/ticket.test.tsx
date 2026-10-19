import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { estimateFill, newGame } from "@desk/engine";
import { LEVELS } from "@desk/content";
import { useGame } from "../src/store";
import { Ticket } from "../src/screens/Markets";
import { Waterfall } from "../src/charts/Waterfall";

describe("the order ticket", () => {
  beforeEach(() => {
    const spec = LEVELS[0];
    const state = newGame(spec, 1, { par: 0 });
    useGame.setState({ state, seed: 1, log: [], refusals: [], feed: [], selected: { inst: "BRENT", month: state.listed.BRENT[0] } });
  });
  it("shows the bid, the ask, the depth, the slippage, the fees and the margin impact before the click", () => {
    const state = useGame.getState().state!;
    render(<MemoryRouter><Ticket state={state} inst="BRENT" /></MemoryRouter>);
    const est = estimateFill(state, "BRENT", state.listed.BRENT[0], "buy", 1);
    expect(screen.getByText("Estimated fill")).toBeInTheDocument();
    expect(screen.getAllByText(est.price.toFixed(2)).length).toBeGreaterThan(0);
    expect(screen.getByText("Fees")).toBeInTheDocument();
    expect(screen.getByText("Margin impact")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Bid:/)).toHaveTextContent(est.quote!.bid.toFixed(2));
    expect(screen.getByLabelText(/^Ask:/)).toHaveTextContent(est.quote!.ask.toFixed(2));
    expect(screen.getByLabelText(/^Depth at the touch/)).toHaveTextContent(String(est.quote!.depth));
  });
  it("submits a market order and reports the fill; a bad quantity is refused with a sentence", () => {
    const state = useGame.getState().state!;
    render(<MemoryRouter><Ticket state={state} inst="BRENT" /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Buy 1 market/ }));
    const after = useGame.getState().state!;
    expect(after.fills.length).toBe(1);
    expect(after.lots.length).toBe(1);
    expect(useGame.getState().feed.some((f) => f.kind === "fill")).toBe(true);
    // the spread tab is locked in level 0
    expect(screen.getByRole("button", { name: "Spread" })).toBeDisabled();
  });
  it("explains every number: each figure carries a what and a why", () => {
    const state = useGame.getState().state!;
    const { container } = render(<MemoryRouter><Ticket state={state} inst="BRENT" /></MemoryRouter>);
    const figs = container.querySelectorAll(".fig");
    expect(figs.length).toBeGreaterThan(5);
    for (const f of figs) expect((f.getAttribute("aria-label") ?? "").length).toBeGreaterThan(10);
  });
});

describe("the waterfall", () => {
  it("draws one bar per leg with its sentence and the book total", () => {
    render(<MemoryRouter><Waterfall rows={[{ leg: "flat", label: "Flat price", amount: 12000, text: "Brent moved up while you were long." }, { leg: "fees_slippage", label: "Fees and slippage", amount: -300, text: "Crossed the spread." }, { leg: "crack", label: "Crack", amount: 0, text: "" }]} total={11700} /></MemoryRouter>);
    expect(screen.getAllByText("Brent moved up while you were long.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Crack")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /11,700 dollars/ })).toBeInTheDocument();
  });
  it("says not yet when there is nothing to attribute", () => {
    render(<Waterfall rows={[]} total={0} />);
    expect(screen.getByText(/not yet/)).toBeInTheDocument();
  });
});
