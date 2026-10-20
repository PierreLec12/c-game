import { registerLevel, type LevelSpec } from "@desk/engine";
import { level00 } from "./levels/level_00";
import { level01 } from "./levels/level_01";
import { level02 } from "./levels/level_02";
import { level03 } from "./levels/level_03";
import { level04 } from "./levels/level_04";
import { level05 } from "./levels/level_05";
import { level06 } from "./levels/level_06";
import { level07 } from "./levels/level_07";
import { level08 } from "./levels/level_08";
import { level09 } from "./levels/level_09";

export const LEVELS: LevelSpec[] = [level00, level01, level02, level03, level04, level05, level06, level07, level08, level09];
for (const l of LEVELS) registerLevel(l);

export const TIERS = [
  { tier: 0, name: "The screen", levels: [0] },
  { tier: 1, name: "Paper", levels: [1, 2, 3, 4] },
  { tier: 2, name: "The cargo and the hedge", levels: [5, 6, 7, 8, 9] },
  { tier: 3, name: "Money, counterparties, limits", levels: [10, 11, 12, 13] },
  { tier: 4, name: "Products, gas, options, signals", levels: [14, 15, 16, 17] },
  { tier: 5, name: "Mastery", levels: [18, 19, 20] },
];
export const PLANNED_TITLES: Record<number, string> = {
  5: "First cargo, unhedged on purpose", 6: "The hedge", 7: "Basis and quality", 8: "The hidden time spread", 9: "Freight and chokepoints",
  10: "Working capital", 11: "Counterparties", 12: "The risk manager", 13: "Storage and carry",
  14: "The refinery", 15: "Gas and LNG", 16: "Options", 17: "Signals", 18: "Crises", 19: "The quarter", 20: "Partner",
};

export * from "./cards";
export * from "./glossary";
export * from "./drills";
export * from "./mentor";
export * from "./bot";
export { level00, level01, level02, level03, level04, level05, level06, level07, level08, level09 };
export const ABOUT = `DESK is a single-player commodity trading game: a trader's desk on an accelerated clock, with a curriculum that teaches the job one concept at a time by making you do it and lose money safely when you get it wrong.

What it cannot teach, and says so: relationships, negotiation with a real person, the politics of a trading floor, and real market microstructure. The engine is a model. A player who beats it has learned the mechanics, the discipline and the vocabulary.

Every reference figure in the game (vessel sizes, voyage days, storage costs, margin rates) is a stylised game parameter, labelled as such, with its origin recorded in the engine's reference data. Crisis levels based on real episodes are named as stylised analogues, never as the episode. The game runs offline after it has loaded: no map tiles, no API calls, no telemetry.`;
