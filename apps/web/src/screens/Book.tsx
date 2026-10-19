import { attributionTotals, ckey, grossLots, INSTRUMENTS, monthLabel, netLots, positions, type AttributionLeg, type InstrumentId, type State } from "@desk/engine";
import { useGame } from "../store";
import { Fig } from "../components/Fig";
import { Waterfall } from "../charts/Waterfall";

export const LEG_LABEL: Record<AttributionLeg, string> = { flat: "Flat price", basis: "Basis (Brent-WTI)", time_spread: "Time spread", crack: "Crack", fees_slippage: "Fees and slippage", fx: "FX", finance: "Finance", options: "Options", freight: "Freight", storage: "Storage", quality: "Quality" };

export function waterfallRows(state: State) {
  const totals = attributionTotals(state.pnl.attribution);
  const sentence = (leg: AttributionLeg) => {
    const rows = state.pnl.attribution.filter((r) => r.leg === leg);
    if (!rows.length) return "";
    const biggest = rows.reduce((a, r) => (Math.abs(r.amount) > Math.abs(a.amount) ? r : a), rows[0]);
    return `${rows.length} row${rows.length > 1 ? "s" : ""}; the largest: ${biggest.text}`;
  };
  return (Object.keys(totals) as AttributionLeg[]).map((leg) => ({ leg, label: LEG_LABEL[leg], amount: totals[leg], text: sentence(leg) }));
}

export function Book() {
  const state = useGame((g) => g.state);
  const submit = useGame((g) => g.submit);
  if (!state) return <div className="panel"><h1>Book and risk</h1><p className="notyet">not yet: start a level from the Academy.</p></div>;
  const pos = positions(state);
  const net = netLots(state);
  const gross = grossLots(state);
  const unreal = state.pnl.unrealised;
  return (
    <div className="grid cols-2">
      <div className="panel accent-crude" id="positions" style={{ gridColumn: "1 / -1" }}>
        <h2>Positions</h2>
        {pos.length === 0 ? <div className="muted">No open positions. {state.lots.length === 0 && state.fills.length > 0 ? "Flat." : ""}</div> : (
          <table>
            <thead><tr><th>Instrument</th><th>Month</th><th className="num">Lots</th><th className="num">Avg entry</th><th className="num">Last settle mark</th><th className="num">Mid</th><th className="num">Unrealised since settle</th><th>Tags</th><th></th></tr></thead>
            <tbody>{pos.map((p) => { const spec = INSTRUMENTS[p.inst]; return (
              <tr key={`${p.inst}${p.month}`}>
                <td>{spec.name}</td><td>{monthLabel(p.month)}</td>
                <td className="num"><Fig v={p.qty} fmt="lots" what="Net lots" why={`${p.lotIds.length} lot${p.lotIds.length > 1 ? "s" : ""} netted; positive is long.`} /></td>
                <td className="num"><Fig v={p.avgEntry} fmt="px" decimals={spec.decimals} what="Average entry price" why="Fill prices weighted by lots." /></td>
                <td className="num"><Fig v={p.lastMark} fmt="px" decimals={spec.decimals} what="Mark at the last settle (or entry)" why="The base for today's variation margin." /></td>
                <td className="num"><Fig v={p.mid} fmt="px" decimals={spec.decimals} what="Mid now" why={state.quotes[ckey(p.inst, p.month)]?.why} at={state.quotes[ckey(p.inst, p.month)]?.at} /></td>
                <td className="num"><Fig v={p.unrealised} fmt="usd" sign what="Unrealised since the last settle" why={`(mid ${p.mid?.toFixed(spec.decimals)} - mark ${p.lastMark.toFixed(spec.decimals)}) x ${p.qty} lots x ${spec.lot.toLocaleString()}${spec.currency === "EUR" ? ` x EURUSD ${state.factors.eurusd.toFixed(4)}` : ""}.`} /></td>
                <td className="small muted">{p.tags.join(", ")}</td>
                <td><button onClick={() => submit({ type: "close", player: "p1", inst: p.inst, month: p.month })} disabled={state.level.status !== "running"}>Close</button></td>
              </tr>); })}</tbody>
          </table>
        )}
        <div className="small muted" style={{ marginTop: 6 }}>Unrealised since settle <Fig v={unreal} fmt="usd" sign what="Unrealised P&L since the last settle" why="Sum over open lots of (mid - last mark) x lots x lot size." /> · realised <Fig v={state.pnl.realised} fmt="usd" sign what="Realised P&L" why="Variation margin received at settles plus closed lots, before fees and interest." /> · fees <Fig v={-state.pnl.fees} fmt="usd" sign what="Fees paid" why="Exchange and clearing fees on every fill." /> · interest <Fig v={-state.pnl.interest} fmt="usd" sign what="Interest paid" why="Daily interest on the drawn line at base plus 150 bp." /></div>
      </div>
      <div className="panel">
        <h2>Greeks</h2>
        <table><thead><tr><th>Instrument</th><th className="num">Delta (units)</th><th className="num">Gamma</th><th className="num">Vega</th><th className="num">Theta</th></tr></thead>
          <tbody>{(Object.keys(net) as InstrumentId[]).filter((i) => net[i] !== 0).map((i) => <tr key={i}><td>{INSTRUMENTS[i].name}</td><td className="num"><Fig v={net[i] * INSTRUMENTS[i].lot} fmt="int" what="Delta in underlying units" why={`${net[i]} lots x ${INSTRUMENTS[i].lot.toLocaleString()} ${INSTRUMENTS[i].lotUnit}: a future has delta one.`} /></td><td className="num"><Fig v={null} what="Gamma" notYet="No options on the book until level 16." /></td><td className="num"><Fig v={null} what="Vega" notYet="No options on the book until level 16." /></td><td className="num"><Fig v={null} what="Theta" notYet="No options on the book until level 16." /></td></tr>)}
            {Object.values(net).every((x) => x === 0) && <tr><td colSpan={5} className="muted">flat</td></tr>}</tbody></table>
      </div>
      <div className="panel accent-risk" id="var">
        <h2>VaR and stress</h2>
        <div className="big"><Fig v={state.risk.var95?.v ?? null} fmt="usd" what="One-day 95% VaR" why={state.risk.var95?.why} at={state.risk.var95?.at} notYet="Not enough shared history yet." /> <span className="muted small">against a limit of</span> <Fig v={state.risk.limits.var95} fmt="usd" what="VaR limit" why="The risk manager's limit for this level." /></div>
        <div className="small muted">Historical simulation on {state.history.length} simulated sessions: each session's return of every contract you hold, applied to today's book; the 95th percentile of the losses.</div>
        <table style={{ marginTop: 8 }}><thead><tr><th>Price shock</th><th>Vol shock</th><th className="num">P&L change</th></tr></thead>
          <tbody>{state.risk.stress.map((s, i) => <tr key={i}><td>{(s.priceShock * 100).toFixed(0)}%</td><td>{(s.volShock * 100).toFixed(0)} pts</td><td className="num"><Fig v={s.pnlChange} fmt="usd" sign what="Book P&L change under the shock" why="Full re-pricing of every position with all prices shocked together; vol shocks matter once options are on the book." at={state.risk.var95?.at} /></td></tr>)}
            {!state.risk.stress.length && <tr><td colSpan={3} className="notyet">not yet: the stress table is computed at each close</td></tr>}</tbody></table>
      </div>
      <div className="panel" id="waterfall" style={{ gridColumn: "1 / -1" }}>
        <h2>Attribution waterfall <span className="muted">(settled legs; unrealised since settle shown above)</span></h2>
        <Waterfall rows={waterfallRows(state)} total={state.pnl.total - unreal} />
      </div>
      <div className="panel">
        <h2>Limits</h2>
        <table><thead><tr><th>Limit</th><th className="num">Now</th><th className="num">Limit</th><th>Status</th></tr></thead>
          <tbody>
            <LimitRow name="VaR 95% one-day" now={state.risk.var95?.v ?? 0} limit={state.risk.limits.var95} fmt="usd" />
            <LimitRow name="Gross lots" now={gross} limit={state.risk.limits.grossLots} fmt="int" />
            {(Object.keys(net) as InstrumentId[]).filter((i) => state.level.instruments.includes(i)).map((i) => <LimitRow key={i} name={`Net lots ${INSTRUMENTS[i].name}`} now={Math.abs(net[i])} limit={state.risk.limits.netLots[i]} fmt="int" />)}
            <LimitRow name="Stop-loss (level P&L)" now={Math.max(0, -(state.pnl.total - state.risk.stopLossRef))} limit={state.risk.limits.stopLoss} fmt="usd" />
            <LimitRow name="Drawdown from peak" now={state.risk.maxDrawdown} limit={state.risk.limits.drawdown} fmt="usd" />
          </tbody></table>
        <div className="small muted" style={{ marginTop: 6 }}>A breach at a close: a warning, then a forced reduction, then a life. Stop-loss and drawdown take a life at once.</div>
        <RequestLimit />
      </div>
      <div className="panel accent-risk">
        <h2>Risk manager</h2>
        {state.risk.messages.length === 0 ? <div className="muted">Nothing yet. Keep it that way.</div> : <div className="feed">{[...state.risk.messages].reverse().map((m, i) => <div key={i} className={`row ${m.severity === "info" ? "" : "limit_warning"}`}><span className="t">t{m.tick}</span><span>{m.text}</span></div>)}</div>}
      </div>
    </div>
  );
}

function LimitRow({ name, now, limit, fmt }: { name: string; now: number; limit: number; fmt: "usd" | "int" }) {
  const over = now > limit;
  return <tr><td>{name}</td><td className="num"><Fig v={now} fmt={fmt} what={name} why="Current value on the book." /></td><td className="num"><Fig v={limit} fmt={fmt} what={`${name} limit`} why="Set by the level; a request can raise it on a clean track record." /></td><td><span className={`badge ${over ? "bad" : "ok"}`}>{over ? "breach" : "inside"}</span></td></tr>;
}

function RequestLimit() {
  const submit = useGame((g) => g.submit);
  const state = useGame((g) => g.state)!;
  return <div className="flex small" style={{ marginTop: 6 }}><span className="muted">Ask the risk manager:</span><button onClick={() => submit({ type: "request_limit", player: "p1", limit: "var95", value: Math.round(state.risk.limits.var95 * 1.5) })} disabled={!state.level.unlockedActions.includes("request_limit")}>Raise VaR limit 50%</button></div>;
}
