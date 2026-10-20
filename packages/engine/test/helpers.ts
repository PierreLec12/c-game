import { registerLevel, type LevelSpec } from "../src/levels";
import type { State } from "../src/types";

/** A plain paper level for engine tests: Brent and WTI, no events unless given, generous limits. */
export function testLevel(over: Partial<LevelSpec> = {}): LevelSpec {
  const spec: LevelSpec = {
    id: 900, tier: 1, title: "Test level", subtitle: "", days: 12, startDate: "2027-01-04", capital: 5e6, creditLine: 20e6, lives: 3,
    instruments: ["BRENT", "WTI", "RBOB", "ULSD", "HH", "TTF"],
    unlocks: ["order", "spread", "roll", "close", "cancel_order", "draw_line", "repay_line", "post_margin", "convert_fx", "open_card", "ask_mentor", "answer_drill", "answer_quiz", "end_level", "request_limit"],
    regime: "normal", world: { oecdInvGap: 0, usInvGap: 0 }, factors: { brentRef: 75 },
    limits: { var95: 2e6, netLots: { BRENT: 5000, WTI: 5000, RBOB: 5000, ULSD: 5000, HH: 5000, TTF: 5000, DUBAI: 5000 }, grossLots: 10000, stopLoss: 4e6, drawdown: 4.5e6, concentration: 50 },
    events: [], briefing: "test", objectives: [], cards: [], pass: () => true, quiz: () => [], par: 1, solve: () => [], seeds: [1], passRuleText: "",
    ...over,
  };
  registerLevel(spec);
  return spec;
}

export function front(state: State, inst: "BRENT" | "WTI" | "RBOB" | "ULSD" | "HH" | "TTF" = "BRENT"): string {
  return state.listed[inst][0];
}
