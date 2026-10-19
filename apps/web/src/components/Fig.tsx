/**
 * An explained number (non-negotiable 3): hovering or focusing shows what it is, what it was derived from and at
 * which tick. Nothing on screen is a bare number: every figure the UI renders goes through this component.
 */
import { useGame } from "../store";
import { formatClock } from "@desk/engine";

export type Fmt = "usd" | "usdK" | "px" | "int" | "pct" | "signed" | "raw" | "lots";

export function fmtValue(v: number, fmt: Fmt, decimals = 2): string {
  switch (fmt) {
    case "usd": return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
    case "usdK": return Math.abs(v) >= 1e6 ? (v < 0 ? "-$" : "$") + (Math.abs(v) / 1e6).toFixed(2) + "m" : Math.abs(v) >= 1e4 ? (v < 0 ? "-$" : "$") + (Math.abs(v) / 1e3).toFixed(0) + "k" : (v < 0 ? "-$" : "$") + Math.abs(Math.round(v)).toLocaleString();
    case "px": return v.toFixed(decimals);
    case "int": return Math.round(v).toLocaleString();
    case "lots": return Math.round(v).toLocaleString() + (Math.abs(Math.round(v)) === 1 ? " lot" : " lots");
    case "pct": return (v * 100).toFixed(decimals) + "%";
    case "signed": return (v >= 0 ? "+" : "") + v.toFixed(decimals);
    default: return String(v);
  }
}

export interface FigProps {
  v: number | null | undefined;
  fmt?: Fmt;
  decimals?: number;
  /** what it is */
  what: string;
  /** what it was derived from */
  why?: string;
  /** the tick it was produced at; defaults to the current tick */
  at?: number;
  /** shown when v is null: why the value does not exist yet */
  notYet?: string;
  className?: string;
  sign?: boolean; // colour by sign
  stylised?: boolean;
}

export function Fig({ v, fmt = "raw", decimals = 2, what, why, at, notYet, className, sign, stylised }: FigProps) {
  const state = useGame((g) => g.state);
  const tick = at ?? state?.tick ?? 0;
  const clock = state ? formatClock(state.startDay, tick) : `tick ${tick}`;
  if (v === null || v === undefined || Number.isNaN(v)) {
    return (
      <span className={`fig notyet ${className ?? ""}`} tabIndex={0} aria-label={`${what}: not yet. ${notYet ?? ""}`}>
        not yet
        <span className="tip" role="tooltip"><div className="what">{what}</div><div>{notYet ?? "The engine has not produced this value yet."}</div></span>
      </span>
    );
  }
  const text = fmtValue(v, fmt, decimals);
  const cls = sign ? (v > 0 ? "pos" : v < 0 ? "neg" : "") : "";
  return (
    <span className={`fig ${cls} ${className ?? ""}`} tabIndex={0} aria-label={`${what}: ${text}. ${why ?? ""} At ${clock}.`}>
      {text}{stylised && <span className="stylised">stylised</span>}
      <span className="tip" role="tooltip">
        <div className="what">{what}</div>
        {why && <div>{why}</div>}
        <div className="at">at {clock} (tick {tick})</div>
      </span>
    </span>
  );
}
