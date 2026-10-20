/**
 * The mentor has a name and a voice: dry, short, never cheerful about losses. Verbosity falls by tier.
 */
import type { EngineEvent, State } from "@desk/engine";

export const MENTOR = { name: "Ines Varga", role: "Mentor", initials: "IV" };
export const RISK_MANAGER = { name: "Tomas Lindqvist", role: "Risk manager", initials: "TL" };

const usd = (x: number) => (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString();

/** Tier-1 verbosity: a line on every first and every consequence. Later tiers pass a smaller set. */
export function tier1Mentor(state: State, events: EngineEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    switch (e.kind) {
      case "fill": {
        const d = e.data as { realised?: number; qty?: number; side?: string } | undefined;
        if (state.fills.length === 1) out.push("Filled. You paid the ask. The mark is the mid, so you are already a half-spread down. That is the price of doing anything.");
        else if (d?.realised && d.realised !== 0) out.push(d.realised > 0 ? `Closed for ${usd(d.realised)}. Fine. Now say where it came from before you do it again.` : `Closed for ${usd(d.realised)}. The attribution tells you which leg lost; read it before the next trade.`);
        break;
      }
      case "margin_call": out.push("That is a margin call. The clearer does not care about your view. Cut the book or fund it by the close."); break;
      case "liquidation": out.push("Liquidated at the touch. The book was sized to the line, not to a bad day. Size before direction."); break;
      case "limit_warning": out.push("Risk has you over a limit. Reduce now; he reduces worse."); break;
      case "forced_reduction": out.push("He cut you. Expensive, and it was avoidable at yesterday's close."); break;
      case "life_lost": out.push("A life. The book is flat. Replay this in your head before the clock runs."); break;
      case "expiry": out.push("That contract expired with you in it. If the position had to live longer, the roll was your job."); break;
      case "release": {
        const d = e.data as { surprise?: number } | undefined;
        if (d && typeof d.surprise === "number") out.push(Math.abs(d.surprise) > 2 ? `A ${Math.abs(d.surprise).toFixed(1)} mb surprise. The consensus was in the price; this part was not.` : "Close to consensus. Nothing to trade in the print itself.");
        break;
      }
      case "news": if (e.text.startsWith("Sources:")) out.push("A leak. Two in three are right. Ask what the price already paid for it."); break;
      case "level_ended": out.push("Done. Open the debrief and answer honestly; the score cares whether you understood it."); break;
    }
  }
  return out;
}

export function askMentorTier1(state: State, topic: string): string {
  const t = topic.toLowerCase();
  if (t.includes("size") || t.includes("how many") || t.includes("lots")) return `Your VaR limit is ${usd(state.risk.limits.var95)}. Buy a few lots, read the VaR on the Book, and scale to the limit. Never the other way round.`;
  if (t.includes("margin")) return `Initial margin is held against the position: ${usd(state.finance.marginRequired)} right now. Variation margin is the day's P&L in cash at the settle.`;
  if (t.includes("spread") || t.includes("contango") || t.includes("backwardation")) return `The front Brent spread is ${state.factors.spread1.BRENT.toFixed(2)} a month: ${state.factors.spread1.BRENT > 0 ? "contango, the long pays the roll" : "backwardation, the long earns it"}.`;
  if (t.includes("pnl") || t.includes("p&l") || t.includes("lost") || t.includes("lose")) return `Level P&L is ${usd(state.pnl.total)}. The waterfall on the Book says which leg did it. Read the sentence on each bar.`;
  if (t.includes("release") || t.includes("inventory") || t.includes("print")) return "A release moves the market by the surprise, not by the number. Be sized for the surprise or be flat.";
  if (t.includes("leak") || t.includes("rumour")) return "Leaks are right about two times in three. The price already paid for most of that. Trade the base rate, not the story.";
  return "Ask about size, margin, the spread, your P&L, a release or a leak. Or open a card.";
}

/** Tier-4 verbosity: consequences only; the firsts are assumed known. */
export function tier4Mentor(state: State, events: EngineEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    switch (e.kind) {
      case "margin_call": out.push("Margin call. Fund it or cut it by the close."); break;
      case "liquidation": out.push("Liquidated at the touch."); break;
      case "forced_reduction": out.push("He cut you. It was cheaper yesterday."); break;
      case "life_lost": out.push("A life."); break;
      case "expiry": out.push(e.text.includes("intrinsic") ? "An option expired on you. The hedge has a date; so does the thing it hedges." : "That contract expired with you in it."); break;
      case "level_ended": out.push("Done. The debrief is where the score is."); break;
    }
  }
  void state;
  return out;
}
export function askMentorTier4(state: State, topic: string): string {
  const t = topic.toLowerCase();
  if (t.includes("delta") || t.includes("greek")) return "Delta is the hedge ratio now; gamma is how wrong it will be after the next move. Read the Greeks table on the Book, then sell or buy the futures that make net delta what you want.";
  if (t.includes("vol") || t.includes("vega") || t.includes("theta")) return `Brent vol is ${(state.factors.vol.BRENT * 100).toFixed(0)}%. Long options pay theta every day for the right to be long vega. Decide which you are being paid for.`;
  if (t.includes("crack") || t.includes("refinery") || t.includes("slate")) return "The plant is long the crack. Sell it forward in 3-2-1 packages for the days it will run, no more. The slate is a daily choice: the cheaper crude at today's differentials.";
  if (t.includes("netback") || t.includes("lng") || t.includes("mmbtu") || t.includes("mwh")) return "Work the delivered price back to the plant: hub less regas less shipping less the buyer's margin. Hedge the leg in the contract it prices on, in its own units: 3.412 MMBtu to the MWh.";
  if (t.includes("signal") || t.includes("rumour") || t.includes("feed")) return "A signal moves before the headline; a rumour moves the price and then resolves. Trade the series when it leaves its baseline twice, size it as a view, and be out when the headline says it was noise.";
  return askMentorTier1(state, topic);
}
