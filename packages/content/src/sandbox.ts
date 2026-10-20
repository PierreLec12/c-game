/**
 * Sandbox mode (level 20 onward, section 9): any level, any seed, any knob, no scoring. A sandbox spec is a registered level
 * built from a base level and a set of knobs; the knobs travel with the save so a replay rebuilds the same spec.
 */
import { registerLevel, type LevelSpec, type Regime } from "@desk/engine";
import { LEVELS } from "./index";

export interface SandboxKnobs {
  days?: number;
  capital?: number;
  creditLine?: number;
  regime?: Regime;
  infoDelayHours?: number;
  /** multiplies every risk limit (VaR, net and gross lots, stop-loss, drawdown) */
  limitScale?: number;
  lives?: number;
  backMonthDepth?: number;
  stressDepth?: number;
  adversarial?: boolean;
  /** drop the level's scheduled events (a quiet market) */
  noEvents?: boolean;
}
export const SANDBOX_ID_BASE = 100;
export const isSandboxId = (id: number): boolean => id >= SANDBOX_ID_BASE;

/** The sandbox spec for a base level and knobs, registered so the engine can run and replay it. Deterministic for the same inputs. */
export function sandboxSpec(baseId: number, knobs: SandboxKnobs): LevelSpec {
  const base = LEVELS.find((l) => l.id === baseId);
  if (!base) throw new Error(`no level ${baseId}`);
  const k = knobs.limitScale ?? 1;
  const spec: LevelSpec = {
    ...base,
    id: SANDBOX_ID_BASE + base.id,
    title: `Sandbox: ${base.title}`,
    subtitle: `${base.subtitle} (sandbox: no score, knobs as set)`,
    days: knobs.days ?? base.days,
    capital: knobs.capital ?? base.capital,
    creditLine: knobs.creditLine ?? base.creditLine,
    regime: knobs.regime ?? base.regime,
    infoDelayHours: knobs.infoDelayHours ?? base.infoDelayHours,
    lives: knobs.lives ?? base.lives,
    backMonthDepth: knobs.backMonthDepth ?? base.backMonthDepth,
    stressDepth: knobs.stressDepth ?? base.stressDepth,
    adversarial: knobs.adversarial ?? base.adversarial,
    events: knobs.noEvents ? [] : base.events,
    limits: { ...base.limits, var95: base.limits.var95 * k, grossLots: Math.round(base.limits.grossLots * k), stopLoss: base.limits.stopLoss * k, drawdown: base.limits.drawdown * k, netLots: Object.fromEntries(Object.entries(base.limits.netLots).map(([i, v]) => [i, Math.round(v * k)])) as LevelSpec["limits"]["netLots"] },
    noPar: true,
    par: 0,
    pass: () => true,
    quiz: () => [],
    passRuleText: "Sandbox: no pass rule and no score; play with the knobs and read the book.",
  };
  registerLevel(spec);
  return spec;
}
