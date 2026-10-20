/**
 * The level contract between the engine and the content package. The engine runs any LevelSpec;
 * the content package registers the twenty-one levels. The registry keeps tick() and replay()
 * at the prompt's signatures (a level id, not a spec).
 */
import type { InstrumentId } from "./refdata";
import type { FactorInit } from "./markets";
import type { WorldInit } from "./world";
import type { Action, ActionType, DrillQuestion, EngineEvent, QuizQuestion, Regime, RiskLimits, State } from "./types";
import type { Grade } from "./world_data";

export interface EventSchedule {
  id?: string;
  kind: string;
  day: number; // level day, 0-based
  hour?: number; // UTC hour, default 9
  params?: Record<string, number | string | boolean>;
}

export interface Objective {
  id: string;
  text: string;
  check: (state: State) => "pending" | "done" | "failed";
  detail?: (state: State) => string;
}

export interface CardTrigger {
  id: string;
  trigger: (state: State, events: EngineEvent[]) => boolean;
}

export interface LevelSpec {
  id: number;
  tier: number;
  title: string;
  subtitle: string;
  days: number;
  startDate: string; // ISO date of day 0
  capital: number;
  creditLine: number;
  lives: number;
  instruments: InstrumentId[];
  unlocks: ActionType[];
  regime: Regime;
  world: WorldInit;
  /** The world the pre-history ran under (default: the level's world). A level whose world differs starts with the price at the pre-history equilibrium and the new anchor pulling it: designed drift. */
  prehistoryWorld?: WorldInit;
  factors: FactorInit;
  limits: RiskLimits;
  events: EventSchedule[];
  briefing: string;
  objectives: Objective[];
  cards: CardTrigger[];
  /** Mentor lines in reaction to this tick's events; verbosity is the level's business. */
  mentor?: (state: State, events: EngineEvent[]) => string[];
  askMentor?: (state: State, topic: string) => string;
  /** The level's own stricter pass rule on top of the score. */
  pass: (state: State) => boolean;
  quiz: (state: State) => QuizQuestion[];
  drills?: (seed: number) => DrillQuestion[];
  /** The bot's P&L on the default seed (seeds[0]), checked in as a regression test; the live par is computed per seed. */
  par: number;
  /** true for a level with no P&L target (orientation): the P&L component of the score is a flat 100 */
  noPar?: boolean;
  solve: (state: State) => Action[];
  seeds: number[];
  /** process checklist weight: objectives counted as done over total */
  passRuleText: string;
  /** tier knob: hours between a shock and its headline for the delayable event kinds (0 in tiers 0 to 2) */
  infoDelayHours?: number;
  /** the player's refinery (level 14 onward): the plant is built at the level start with this slate and run rate */
  refinery?: { slate: Grade; runs: number };
  /** the assessment and signals feed is included in the level (otherwise it is bought on the Intel screen) */
  feedIncluded?: boolean;
  /** tier knob: depth multiplier for the third listed month and beyond (thin back months in tier 4) */
  backMonthDepth?: number;
  /** tier knob: depth multiplier in the stressed and crisis regimes on top of the regime's own (Partner: liquidity halves in stress) */
  stressDepth?: number;
  /** tier knob: counterparties price the player's known positions against them (Partner) */
  adversarial?: boolean;
  /** the book the player inherits: actions applied at tick 0 before the player's first tick (an opening position, a cargo already bought) */
  opening?: Action[];
  /** the screen picks a fresh seed every run instead of the level's list (Partner) */
  freshSeed?: boolean;
  /** the level ends when the player ends it (Partner); `days` is only the clock's ceiling */
  endless?: boolean;
  /** the mentor says nothing but what is asked (tier 5) */
  mentorSilent?: boolean;
}

const registry = new Map<number, LevelSpec>();
export function registerLevel(spec: LevelSpec): void { registry.set(spec.id, spec); }
export function getLevel(id: number): LevelSpec {
  const s = registry.get(id);
  if (!s) throw new Error(`level ${id} is not registered`);
  return s;
}
export function hasLevel(id: number): boolean { return registry.has(id); }
export function allLevels(): LevelSpec[] { return [...registry.values()].sort((a, b) => a.id - b.id); }
