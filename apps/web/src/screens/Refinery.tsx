/**
 * The refinery (level 14): the plant's capacity, run rate, slate, status, yields at today's prices, the margin per
 * barrel and the crack hedge against it. Everything is read from the engine; the panel submits set_runs and set_slate.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { crackHedgeTargetUnits, crackUnitsHeld, effectiveRuns, formatClock, GRADES, REFINERY, refineryMarginPerBbl, screenCrack321, SLATES, type Slate, type State } from "@desk/engine";
import { useGame } from "../store";
import { Fig } from "../components/Fig";
import { Sparkline } from "../charts/Sparkline";

const PRODUCT: Record<"gasoline" | "diesel" | "jet" | "fuelOil", string> = { gasoline: "Gasoline", diesel: "Diesel", jet: "Jet", fuelOil: "Fuel oil" };
const usd = (x: number) => (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString();

export function CoverageBar({ coverage }: { coverage: number }) {
  return <span style={{ display: "inline-block", width: 120, height: 10, background: "var(--navy-3)", borderRadius: 5, verticalAlign: "middle", position: "relative" }}><span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, coverage * 100)}%`, background: coverage > 1.1 || coverage < 0.9 ? "var(--risk)" : "var(--cash)", borderRadius: 5 }} /></span>;
}

export function RefineryPanel({ state }: { state: State }) {
  const submit = useGame((g) => g.submit);
  const select = useGame((g) => g.select);
  const refusals = useGame((g) => g.refusals);
  const r = state.refinery!;
  const [runs, setRuns] = useState(Math.round(r.runs * 100));
  const running = state.level.status === "running";
  const m = refineryMarginPerBbl(state, r.slate);
  const eff = effectiveRuns(state);
  const shut = r.shutUntil !== null && r.shutUntil > state.tick;
  const turnaround = !shut && r.maintenanceUntil !== null && r.maintenanceUntil > state.tick;
  const remainingDays = Math.max(0, Math.ceil((state.level.endTick - state.tick) / 24));
  const target = crackHedgeTargetUnits(state, remainingDays);
  const held = crackUnitsHeld(state);
  const screen = screenCrack321(state);
  const todayBbl = r.capacityKbd * 1000 * eff;
  const fixed = REFINERY.fixedCostPerBblCapacityDay.value * r.capacityKbd * 1000;
  const yields = REFINERY.yields.value[r.slate as Slate] ?? REFINERY.yields.value.WTI_MIDLAND;
  const coverage = target > 0 ? Math.min(1.5, Math.max(0, -held.units / target)) : null;
  const lastRefusal = [...refusals].reverse().find((x) => x.action.type === "set_runs" || x.action.type === "set_slate");
  const last = r.history[r.history.length - 1];
  const crudeName = GRADES[r.slate].name;
  return (
    <div className="panel accent-gas" id="refinery" style={{ gridColumn: "1 / -1" }}>
      <div className="flex">
        <h2 style={{ margin: 0 }}>Refinery <span className="muted">(one stylised plant; its margin is realised daily in the refinery leg)</span></h2>
        {shut ? <span className="badge bad">shut until {formatClock(state.startDay, r.shutUntil!)}</span> : turnaround ? <span className="badge warn">turnaround until {formatClock(state.startDay, r.maintenanceUntil!)}: runs capped at {Math.round(REFINERY.turnaroundRuns.value * 100)}%</span> : <span className="badge ok">running</span>}
        {r.pendingSlate && <span className="badge warn">switching to {GRADES[r.pendingSlate].name} at the next day's run</span>}
      </div>
      <div className="grid cols-2" style={{ marginTop: 8 }}>
        <div>
          <div className="small" style={{ marginBottom: 6 }}>
            Capacity <Fig v={r.capacityKbd} fmt="int" what="Plant capacity, kb/d" why={REFINERY.capacityKbd.basis} stylised /> kb/d · runs set <Fig v={r.runs} fmt="pct" decimals={0} what="Run rate set" why="Your setting, as a share of capacity." /> · effective <Fig v={eff} fmt="pct" decimals={0} what="Run rate the plant can make today" why={shut ? "Zero while the plant is shut." : turnaround ? `Capped at ${Math.round(REFINERY.turnaroundRuns.value * 100)}% during a turnaround.` : "Your setting: the plant is running normally."} /> · today <Fig v={todayBbl} fmt="int" what="Crude run today, bbl" why={`${r.capacityKbd} kb/d x ${Math.round(eff * 100)}%.`} /> bbl of {crudeName}
          </div>
          <div className="flex small" style={{ marginBottom: 8 }}>
            <label className="muted">runs <input type="range" min={0} max={100} step={5} value={runs} onChange={(e) => setRuns(Number(e.target.value))} aria-label="run rate as a share of capacity" /> {runs}%</label>
            <button onClick={() => submit({ type: "set_runs", player: "p1", runs: runs / 100 })} disabled={!running || runs === Math.round(r.runs * 100)}>Set runs</button>
            <span className="muted">fixed cost <Fig v={fixed} fmt="usd" what="Fixed cost a day" why={`${REFINERY.fixedCostPerBblCapacityDay.value.toFixed(2)} $/bbl of capacity a day, paid whether the plant runs or not (stylised).`} stylised /> a day whatever the runs</span>
          </div>
          <table>
            <thead><tr><th>Slate</th><th className="num">Margin $/bbl</th><th className="num">Crude delivered</th><th></th></tr></thead>
            <tbody>{SLATES.map((s) => { const ms = refineryMarginPerBbl(state, s); const current = r.slate === s; const pending = r.pendingSlate === s; return (
              <tr key={s} className={current ? "selected" : ""}>
                <td>{GRADES[s].name}{current && <span className="badge ok">current</span>}{pending && <span className="badge warn">from the next run</span>}</td>
                <td className="num"><Fig v={ms.perBbl} fmt="signed" decimals={2} what={`${GRADES[s].name} margin per barrel at today's prices`} why={ms.why} stylised /></td>
                <td className="num"><Fig v={ms.crude + ms.delivered} fmt="px" what={`${GRADES[s].name} delivered to the plant, $/bbl`} why={`Benchmark plus the grade differential ${ms.crude.toFixed(2)}, plus delivery ${ms.delivered.toFixed(2)} (stylised).`} stylised /></td>
                <td><button onClick={() => submit({ type: "set_slate", player: "p1", grade: s })} disabled={!running || (current && !r.pendingSlate) || pending}>Run {GRADES[s].name}</button></td>
              </tr>); })}</tbody>
          </table>
          <div className="small muted" style={{ margin: "4px 0 8px" }}>A slate change takes effect at the next day's run ({REFINERY.slateSwitchHours.value} hours, stylised).</div>
          <table>
            <thead><tr><th>Yield on {crudeName}</th><th className="num">Share</th><th className="num">$/bbl</th><th className="num">Per bbl of crude</th></tr></thead>
            <tbody>
              {(Object.keys(PRODUCT) as (keyof typeof PRODUCT)[]).map((k) => { const p = m.products[k]; return (
                <tr key={k}><td>{PRODUCT[k]}</td>
                  <td className="num"><Fig v={p.yieldShare} fmt="pct" decimals={0} what={`${PRODUCT[k]} yield on ${crudeName}`} why={REFINERY.yields.basis} stylised /></td>
                  <td className="num"><Fig v={p.price} fmt="px" what={`${PRODUCT[k]} price, $/bbl`} why={k === "jet" ? `Diesel plus a stylised jet premium of ${REFINERY.jetOverDiesel.value.toFixed(2)}; there is no jet contract.` : "WTI prompt plus the product's crack factor (the model's latent price; the screen's front month is close to it)."} /></td>
                  <td className="num"><Fig v={p.yieldShare * p.price} fmt="px" what="Revenue per barrel of crude" why={`${Math.round(p.yieldShare * 100)}% x ${p.price.toFixed(2)}.`} /></td></tr>); })}
              <tr><td className="muted">Loss</td><td className="num"><Fig v={yields.loss} fmt="pct" decimals={0} what="Processing loss" why={REFINERY.yields.basis} stylised /></td><td /><td /></tr>
              <tr><td className="muted">Crude ({crudeName})</td><td /><td className="num"><Fig v={m.crude} fmt="px" what="Crude cost, $/bbl" why="Benchmark plus the grade's differential." /></td><td className="num"><Fig v={-m.crude} fmt="signed" what="Crude cost per barrel" why="Negative: a cost." /></td></tr>
              <tr><td className="muted">Delivery</td><td /><td /><td className="num"><Fig v={-m.delivered} fmt="signed" what="Delivery to the plant" why={REFINERY.deliveredCrudePerBbl.basis} stylised /></td></tr>
              <tr><td className="muted">Operating cost</td><td /><td /><td className="num"><Fig v={-m.opex} fmt="signed" what="Operating cost per barrel" why={REFINERY.opexPerBbl.basis} stylised /></td></tr>
              <tr><td><strong>Margin</strong></td><td /><td /><td className="num"><Fig v={m.perBbl} fmt="signed" what="Margin per barrel today" why={m.why} stylised /></td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <div className="big"><Fig v={m.perBbl} fmt="signed" what={`Margin per barrel today on ${crudeName}`} why={m.why} stylised /> <span className="muted small">$/bbl today · the day's run would make</span> <Fig v={todayBbl * m.perBbl - fixed} fmt="usd" sign what="Expected margin for today's run" why={`${Math.round(todayBbl).toLocaleString()} bbl x ${m.perBbl.toFixed(2)} less fixed cost ${usd(fixed)}; booked at the 19:00 settle at that hour's prices.`} /></div>
          <table style={{ marginTop: 8 }}>
            <tbody>
              <tr><td>3-2-1 crack on screen</td><td className="num"><Fig v={screen} fmt="signed" what="Front-month 3-2-1 crack from the quotes" why="(2 x RBOB + ULSD - 3 x WTI) / 3 at the front-month mids, products at 42 gal/bbl: the crack you can sell." notYet="RBOB, ULSD and WTI are not all listed in this level." /> <span className="muted small">$/bbl</span></td></tr>
              <tr><td>The plant's crack</td><td className="num"><Fig v={m.crack321} fmt="signed" what="3-2-1 crack at the model's prompt prices" why={`The same formula on the latent prompt prices the plant is marked at. Margin ${m.perBbl.toFixed(2)} differs from it by the slate's yields, the grade differential, delivery and operating cost.`} /> <span className="muted small">$/bbl</span></td></tr>
              <tr><td>Crack units held</td><td className="num"><Fig v={held.units} fmt="signed" decimals={1} what="3-2-1 crack units in the futures book" why={`RBOB ${held.rbob} lots, ULSD ${held.ulsd} lots, WTI ${held.wti} lots. A unit is 2 RBOB + 1 ULSD against 3 WTI (3,000 bbl); positive is long the crack. Only complete units with every leg the same way count.`} /></td></tr>
              <tr><td>Target for {remainingDays} days left</td><td className="num"><Fig v={-target} fmt="signed" decimals={0} what={`Crack units to be short for the rest of the level`} why={`Capacity ${r.capacityKbd} kb/d x runs ${Math.round(r.runs * 100)}% x ${remainingDays} days = ${Math.round(r.capacityKbd * 1000 * r.runs * remainingDays).toLocaleString()} bbl, in 3,000-bbl units. A plant is long the crack by nature: selling it locks the margin.`} /> {coverage !== null && <><CoverageBar coverage={coverage} /> <Fig v={coverage} fmt="pct" decimals={0} what="Crack hedge coverage" why={`Units short (${(-held.units).toFixed(1)}) over the target (${target}). Red outside 90% to 110%.`} /></>}</td></tr>
              <tr><td>Realised margin this level</td><td className="num"><Fig v={r.marginUsd} fmt="usd" sign what="Realised refinery margin" why={`${r.daysRun} day${r.daysRun === 1 ? "" : "s"} run; each day's margin lands in cash and in the refinery leg at the settle.`} /></td></tr>
            </tbody>
          </table>
          <div className="small" style={{ marginTop: 8 }}>
            <span className="muted">Daily margin </span>
            {r.history.length >= 2 ? <Sparkline points={r.history.map((h) => h.marginUsd)} colour="var(--gas)" width={220} height={40} label="Daily refinery margin" format={usd} /> : <span className="notyet">not yet: the first day's margin is booked at the 19:00 settle</span>}
            {last && <span className="muted"> · day {last.day}: {usd(last.marginUsd)} on {Math.round(last.crudeBbl / 1000).toLocaleString()} kb at {last.marginPerBbl.toFixed(2)} $/bbl{last.bestSlate && last.bestSlate !== last.slate ? `; ${GRADES[last.bestSlate].name} would have made ${last.bestMarginPerBbl.toFixed(2)}` : ""}</span>}
          </div>
          {state.level.instruments.includes("RBOB") && <div className="small muted" style={{ marginTop: 6 }}><Link to="/markets" onClick={() => select("RBOB", state.listed.RBOB[0])}>Sell crack units on the Markets ticket</Link> (Spread, 3-2-1 crack): the flat and basis legs cancel; the crack and time-spread legs remain.</div>}
          {lastRefusal && <div className="refusal" role="alert">Refused: {lastRefusal.reason}</div>}
        </div>
      </div>
    </div>
  );
}
