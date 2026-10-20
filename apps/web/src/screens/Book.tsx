import { attributionTotals, cargoMark, ckey, coverLotsByInst, formatClock, GRADES, grossLots, INSTRUMENTS, monthLabel, nakedShortOptions, netLots, optionDeltaLots, optionPositions, physicalExposureBbl, PORTS, positions, counterpartyExposure, unitOf, type AttributionLeg, type Greek, type InstrumentId, type State } from "@desk/engine";
import { useGame } from "../store";
import { Fig } from "../components/Fig";
import { Waterfall } from "../charts/Waterfall";

export const LEG_LABEL: Record<AttributionLeg, string> = { flat: "Flat price", basis: "Basis (Brent-WTI)", time_spread: "Time spread", crack: "Crack", fees_slippage: "Fees and slippage", fx: "FX", finance: "Finance", options: "Options", freight: "Freight", demurrage: "Demurrage", storage: "Storage", quality: "Quality", credit: "Credit", refinery: "Refinery margin" };

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
              <tr key={`${p.inst}${p.month}${p.option ? `${p.option.kind}${p.option.strike}` : ""}`}>
                <td>{spec.name}{p.option && <> {p.option.strike} {p.option.kind}<span className="badge">option</span></>}</td><td>{monthLabel(p.month)}</td>
                <td className="num"><Fig v={p.qty} fmt="lots" what="Net lots" why={`${p.lotIds.length} lot${p.lotIds.length > 1 ? "s" : ""} netted; positive is long.`} /></td>
                <td className="num"><Fig v={p.avgEntry} fmt="px" decimals={spec.decimals} what="Average entry price" why="Fill prices weighted by lots." /></td>
                <td className="num"><Fig v={p.lastMark} fmt="px" decimals={spec.decimals} what="Mark at the last settle (or entry)" why="The base for today's variation margin." /></td>
                <td className="num">{p.option ? <Fig v={p.mid} fmt="px" decimals={spec.decimals} what="Model value now" why="Black-76 at the surface vol off the month's future; intrinsic value at expiry." /> : <Fig v={p.mid} fmt="px" decimals={spec.decimals} what="Mid now" why={state.quotes[ckey(p.inst, p.month)]?.why} at={state.quotes[ckey(p.inst, p.month)]?.at} />}</td>
                <td className="num"><Fig v={p.unrealised} fmt="usd" sign what="Unrealised since the last settle" why={`(mid ${p.mid?.toFixed(spec.decimals)} - mark ${p.lastMark.toFixed(spec.decimals)}) x ${p.qty} lots x ${spec.lot.toLocaleString()}${spec.currency === "EUR" ? ` x EURUSD ${state.factors.eurusd.toFixed(4)}` : ""}.`} /></td>
                <td className="small muted">{p.tags.join(", ")}</td>
                <td><button onClick={() => submit(p.option ? { type: "option_order", player: "p1", inst: p.inst, month: p.month, strike: p.option.strike, kind: p.option.kind, side: p.qty > 0 ? "sell" : "buy", qty: Math.abs(p.qty) } : { type: "close", player: "p1", inst: p.inst, month: p.month })} disabled={state.level.status !== "running"}>Close</button></td>
              </tr>); })}</tbody>
          </table>
        )}
        <div className="small muted" style={{ marginTop: 6 }}>Unrealised since settle <Fig v={unreal} fmt="usd" sign what="Unrealised P&L since the last settle" why="Sum over open lots of (mid - last mark) x lots x lot size." /> · realised <Fig v={state.pnl.realised} fmt="usd" sign what="Realised P&L" why="Variation margin received at settles plus closed lots, before fees and interest." /> · fees <Fig v={-state.pnl.fees} fmt="usd" sign what="Fees paid" why="Exchange and clearing fees on every fill." /> · interest <Fig v={-state.pnl.interest} fmt="usd" sign what="Interest paid" why="Daily interest on the drawn line at base plus 150 bp." /></div>
      </div>
      {state.cargoes.length > 0 && (
        <div className="panel" id="physical" style={{ gridColumn: "1 / -1" }}>
          <h2>Physical book <span className="muted">(net unpriced exposure <Fig v={physicalExposureBbl(state).bbl} fmt="int" what="Net unpriced physical barrels" why="Long on unpriced sales and unsold cargoes, short on unpriced purchases; the number the futures hedge should offset." /> bbl)</span></h2>
          <table><thead><tr><th>Cargo</th><th>Route</th><th className="num">Purchase price</th><th className="num">Sale price</th><th className="num">Freight</th><th className="num">Other costs</th><th className="num">Mark</th><th className="num">Exposure</th></tr></thead>
            <tbody>{state.cargoes.map((c) => { const m = cargoMark(state, c); return (
              <tr key={c.id}><td>{c.id} {GRADES[c.grade].name} {c.bbl.toLocaleString()} {unitOf(c)} <span className="badge">{c.status}</span></td><td className="small">{PORTS[c.loadPort].name} to {PORTS[c.dischargePort].name}</td>
                <td className="num"><Fig v={m.purchasePerBbl} fmt="px" decimals={unitOf(c) === "MMBtu" ? 3 : 2} what={`Purchase value per ${unitOf(c) === "MMBtu" ? "MMBtu" : "barrel"} (${c.purchase.basis})`} why="Printed days fixed, unpriced days at today's forward, plus the differential." /></td>
                <td className="num">{m.salePerBbl !== null ? <Fig v={m.salePerBbl} fmt="px" decimals={unitOf(c) === "MMBtu" ? 3 : 2} what={`Sale value per ${unitOf(c) === "MMBtu" ? "MMBtu" : "barrel"} (${c.sale?.basis})`} why="Printed days fixed, unpriced days at today's forward, plus the differential." /> : <Fig v={m.expectedSalePerBbl} fmt="px" decimals={unitOf(c) === "MMBtu" ? 3 : 2} what={`Expected sale per ${unitOf(c) === "MMBtu" ? "MMBtu" : "barrel"} (unsold)`} why={c.grade === "LNG" ? "The delivery hub's forward at the expected discharge less the regas fee and the buyer's margin (the netback)." : "The benchmark forward at the expected discharge plus the market differential delivered."} />}</td>
                <td className="num"><Fig v={-m.freightUsd} fmt="usd" sign what="Freight still to pay" why={c.freight.fixedUsd !== null ? "Fixed charter, paid at delivery." : "Expected: the cheapest fitting quote."} /></td>
                <td className="num"><Fig v={-(m.extra.demurrage + m.extra.warRisk + m.extra.quality)} fmt="usd" sign what="Demurrage, war risk, claims" why="Unpaid extra costs on this cargo." /></td>
                <td className="num"><Fig v={m.valueUsd} fmt="usd" sign what="Cargo mark" why="Everything not yet paid or received, at today's forwards." /></td>
                <td className="num"><Fig v={physicalExposureBbl(state).byCargo[c.id] ?? 0} fmt="int" what={`Net unpriced ${unitOf(c)} of this cargo`} why={c.grade === "LNG" ? "Long on the unpriced sale, short on the unpriced purchase; the legs price on different hubs, so the net understates what is hedged in each contract (see the cargo card on the Desk)." : "Long on the unpriced sale, short on the unpriced purchase."} /> <span className="muted small">{unitOf(c)}</span></td></tr>); })}</tbody></table>
        </div>
      )}
      <GreeksPanel state={state} />
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
        <OptionsByGreek state={state} />
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
            {state.risk.limits.nakedShortOptions !== undefined && <LimitRow name="Naked short options (lots)" now={nakedShortOptions(state, coverLotsByInst(state)).total} limit={state.risk.limits.nakedShortOptions} fmt="int" />}
            {state.risk.limits.concentration < 50 && <LimitRow name="Concentration (largest name, x capital)" now={Math.max(0, ...Object.values(counterpartyExposure(state).byId)) / state.capital} limit={state.risk.limits.concentration} fmt="mult" />}
          </tbody></table>
        <div className="small muted" style={{ marginTop: 6 }}>A breach at a close: a warning, then a forced reduction, then a life. Stop-loss and drawdown take a life at once.</div>
        <RequestLimit />
      </div>
      <div className="panel accent-risk">
        <h2>Risk manager</h2>
        {state.risk.messages.length === 0 ? <div className="muted">Nothing yet. Keep it that way.</div> : <div className="feed" tabIndex={0} aria-label="risk manager messages">{[...state.risk.messages].reverse().map((m, i) => <div key={i} className={`row ${m.severity === "info" ? "" : "limit_warning"}`}><span className="t">t{m.tick}</span><span>{m.text}</span></div>)}</div>}
      </div>
    </div>
  );
}

function LimitRow({ name, now, limit, fmt }: { name: string; now: number; limit: number; fmt: "usd" | "int" | "pct" | "mult" }) {
  const over = now > limit;
  const f = fmt === "mult" ? "px" : fmt;
  return <tr><td>{name}</td><td className="num"><Fig v={now} fmt={f} decimals={1} what={name} why="Current value on the book." /></td><td className="num"><Fig v={limit} fmt={f} decimals={1} what={`${name} limit`} why="Set by the level; a request can raise it on a clean track record." /></td><td><span className={`badge ${over ? "bad" : "ok"}`}>{over ? "breach" : "inside"}</span></td></tr>;
}

function RequestLimit() {
  const submit = useGame((g) => g.submit);
  const state = useGame((g) => g.state)!;
  return <div className="flex small" style={{ marginTop: 6 }}><span className="muted">Ask the risk manager:</span><button onClick={() => submit({ type: "request_limit", player: "p1", limit: "var95", value: Math.round(state.risk.limits.var95 * 1.5) })} disabled={!state.level.unlockedActions.includes("request_limit")}>Raise VaR limit 50%</button></div>;
}

const GREEK_LABEL: Record<Greek, string> = { delta: "Delta (the hedge ratio part of the move)", gamma: "Gamma (the delta changed as the future moved)", vega: "Vega (implied vol moved)", theta: "Theta (time passed)", other: "Other (higher-order terms, skew, settlement)" };

/** The option book by position and by instrument: price, vol, Greeks per lot, delta-equivalent lots, totals, and the naked-short count against its limit. */
function GreeksPanel({ state }: { state: State }) {
  const submit = useGame((g) => g.submit);
  const rows = optionPositions(state);
  const net = netLots(state);
  const optDelta = optionDeltaLots(state);
  const unlocked = state.level.unlockedActions.includes("option_order");
  const naked = nakedShortOptions(state, coverLotsByInst(state));
  const limit = state.risk.limits.nakedShortOptions;
  const lotUsd = (i: InstrumentId) => INSTRUMENTS[i].lot * (INSTRUMENTS[i].currency === "EUR" ? state.factors.eurusd : 1);
  const totals = rows.reduce((a, r) => ({ deltaLots: a.deltaLots + r.deltaLots, gamma: a.gamma + r.qty * r.gamma, vega: a.vega + r.qty * r.vega * lotUsd(r.inst), theta: a.theta + r.qty * r.theta * lotUsd(r.inst) }), { deltaLots: 0, gamma: 0, vega: 0, theta: 0 });
  const insts = (Object.keys(net) as InstrumentId[]).filter((i) => net[i] !== 0 || (optDelta[i] ?? 0) !== 0);
  const notYet = "No options on the book until level 16.";
  return (
    <div className="panel" id="greeks" style={{ gridColumn: "1 / -1" }}>
      <h2>Greeks</h2>
      {rows.length === 0 ? <div className="small" style={{ marginBottom: 6 }}>{unlocked ? <span className="muted">No options on the book. The chain is on Markets.</span> : <span className="notyet">not yet: options unlock at level 16.</span>}</div> : (
        <>
          <div style={{ overflow: "auto" }} tabIndex={0} aria-label="option positions">
            <table>
              <thead><tr><th>Option</th><th className="num">Lots</th><th className="num">Price</th><th className="num">IV</th><th className="num">Delta</th><th className="num">Gamma</th><th className="num">Vega</th><th className="num">Theta</th><th className="num">Delta lots</th><th>Expiry</th><th></th></tr></thead>
              <tbody>{rows.map((r) => { const spec = INSTRUMENTS[r.inst]; const name = `${spec.name} ${monthLabel(r.month)} ${r.strike} ${r.kind}`; return (
                <tr key={`${r.inst}${r.month}${r.kind}${r.strike}`}>
                  <td>{name}</td>
                  <td className="num"><Fig v={r.qty} fmt="lots" what={`${name}: net lots`} why={`${r.lotIds.length} lot${r.lotIds.length > 1 ? "s" : ""} netted; positive is long the option.`} /></td>
                  <td className="num"><Fig v={r.price} fmt="px" decimals={spec.decimals} what="Model value now" why={`Black-76 at the surface vol ${(r.iv * 100).toFixed(1)}% off the ${monthLabel(r.month)} future; intrinsic value at expiry.`} /></td>
                  <td className="num"><Fig v={r.iv} fmt="pct" decimals={1} what="Implied vol" why="The surface vol at this strike's moneyness and tenor." /></td>
                  <td className="num"><Fig v={r.delta} fmt="signed" decimals={2} what="Delta per lot" why="Change in the option's value per unit move in the future; a future has delta one." /></td>
                  <td className="num"><Fig v={r.gamma} fmt="px" decimals={4} what="Gamma per lot" why="Change in delta per unit move in the future." /></td>
                  <td className="num"><Fig v={r.vega} fmt="px" decimals={3} what="Vega per lot" why="Change in the option's value per vol point, in price units." /></td>
                  <td className="num"><Fig v={r.theta} fmt="px" decimals={4} what="Theta per lot" why="Change in the option's value per calendar day, in price units: negative for a long option." /></td>
                  <td className="num"><Fig v={r.deltaLots} fmt="signed" decimals={1} what="Delta-equivalent lots" why={`${r.qty} lots x delta ${r.delta.toFixed(2)}: what this position adds to the futures net.`} /></td>
                  <td className="small muted">{formatClock(state.startDay, r.expiryTick)}</td>
                  <td><button onClick={() => submit({ type: "option_order", player: "p1", inst: r.inst, month: r.month, strike: r.strike, kind: r.kind, side: r.qty > 0 ? "sell" : "buy", qty: Math.abs(r.qty) })} disabled={state.level.status !== "running"}>Close</button></td>
                </tr>); })}</tbody>
            </table>
          </div>
          <div className="small muted" style={{ margin: "6px 0" }}>Option book totals: delta <Fig v={totals.deltaLots} fmt="signed" decimals={1} what="Delta-equivalent lots of every option" why="The sum of lots x delta over the option positions." /> lots · gamma <Fig v={totals.gamma} fmt="signed" decimals={3} what="Gamma of the option book, lots per unit move" why="The sum of lots x gamma: how many delta lots a one-unit move adds." /> · vega <Fig v={totals.vega} fmt="usd" sign what="Vega of the option book, dollars per vol point" why="The sum of lots x vega x lot size: what a one-point rise in implied vol does to the book." /> a vol point · theta <Fig v={totals.theta} fmt="usd" sign what="Theta of the option book, dollars a day" why="The sum of lots x theta x lot size: what a day costs or earns if nothing else moves." /> a day</div>
        </>
      )}
      <table>
        <thead><tr><th>Instrument</th><th className="num">Futures lots</th><th className="num">Option delta lots</th><th className="num">Delta (units)</th><th className="num">Gamma (lots/unit)</th><th className="num">Vega $/pt</th><th className="num">Theta $/day</th></tr></thead>
        <tbody>
          {insts.map((i) => { const spec = INSTRUMENTS[i]; const rs = rows.filter((r) => r.inst === i); const od = optDelta[i] ?? 0; const g = rs.reduce((a, r) => a + r.qty * r.gamma, 0); const v = rs.reduce((a, r) => a + r.qty * r.vega * lotUsd(i), 0); const t = rs.reduce((a, r) => a + r.qty * r.theta * lotUsd(i), 0); return (
            <tr key={i}><td>{spec.name}</td>
              <td className="num"><Fig v={net[i]} fmt="lots" what="Net futures lots" why="Futures only; positive is long." /></td>
              <td className="num">{unlocked ? <Fig v={od} fmt="signed" decimals={1} what="Delta-equivalent lots from options" why="The sum of lots x delta over this instrument's options." /> : <Fig v={null} what="Option delta lots" notYet={notYet} />}</td>
              <td className="num"><Fig v={(net[i] + od) * spec.lot} fmt="int" what="Delta in underlying units" why={`(${net[i]} futures lots + ${od.toFixed(2)} option delta lots) x ${spec.lot.toLocaleString()} ${spec.lotUnit}: a future has delta one.`} /></td>
              <td className="num">{unlocked ? <Fig v={g} fmt="signed" decimals={3} what="Gamma, lots per unit move" why="The sum of lots x gamma over this instrument's options." /> : <Fig v={null} what="Gamma" notYet={notYet} />}</td>
              <td className="num">{unlocked ? <Fig v={v} fmt="usd" sign what="Vega in dollars per vol point" why="The sum of lots x vega x lot size." /> : <Fig v={null} what="Vega" notYet={notYet} />}</td>
              <td className="num">{unlocked ? <Fig v={t} fmt="usd" sign what="Theta in dollars a day" why="The sum of lots x theta x lot size." /> : <Fig v={null} what="Theta" notYet={notYet} />}</td>
            </tr>); })}
          {insts.length === 0 && <tr><td colSpan={7} className="muted">flat</td></tr>}
        </tbody>
      </table>
      {unlocked && (
        <div className="small muted" style={{ marginTop: 6 }}>
          Naked short options <Fig v={naked.total} fmt="lots" what="Short option lots not covered by the underlying" why={`A short call needs long futures or long physical in the same instrument behind it, a short put short ones. ${Object.entries(naked.byInst).map(([i, r]) => (r ? `${INSTRUMENTS[i as InstrumentId].name}: ${r.calls} short call${r.calls === 1 ? "" : "s"}, ${r.puts} short put${r.puts === 1 ? "" : "s"}, cover ${r.cover.toFixed(1)} lots, naked ${r.naked}` : "")).filter(Boolean).join("; ") || "no short options"}.`} />
          {limit !== undefined ? <> against a limit of <Fig v={limit} fmt="lots" what="Naked short option limit" why="Set by the level; a breach at a close is a warning, then a forced reduction, then a life." /> <span className={`badge ${naked.total > limit ? "bad" : "ok"}`}>{naked.total > limit ? "breach" : "inside"}</span></> : <span className="badge">no limit in this level</span>}
        </div>
      )}
    </div>
  );
}

/** The options leg of the waterfall split by Greek: what part of the option P&L was delta, gamma, vega, theta, or the rest. */
function OptionsByGreek({ state }: { state: State }) {
  const rows = state.pnl.attribution.filter((r) => r.leg === "options");
  if (!rows.length) return state.level.unlockedActions.includes("option_order") ? <div className="small notyet" style={{ marginTop: 8 }}>not yet: options by Greek appear after the first settle or close with an option on the book.</div> : null;
  const greeks: Greek[] = ["delta", "gamma", "vega", "theta", "other"];
  const by = greeks.map((g) => { const rs = rows.filter((r) => (r.greek ?? "other") === g); const sum = rs.reduce((a, r) => a + r.amount, 0); const biggest = rs.length ? rs.reduce((a, r) => (Math.abs(r.amount) > Math.abs(a.amount) ? r : a), rs[0]) : null; return { g, sum, n: rs.length, text: biggest?.text ?? "" }; });
  const total = rows.reduce((a, r) => a + r.amount, 0);
  return (
    <div id="options-by-greek" style={{ marginTop: 10 }}>
      <h3>Options by Greek <span className="muted small">(the options leg, {rows.length} rows, <Fig v={total} fmt="usd" sign what="Options leg total" why="The sum of every options attribution row." />)</span></h3>
      <table>
        <thead><tr><th>Greek</th><th className="num">USD</th><th>What moved</th></tr></thead>
        <tbody>{by.map((b) => <tr key={b.g}><td>{GREEK_LABEL[b.g]}</td><td className="num">{b.n ? <Fig v={b.sum} fmt="usd" sign what={`Options P&L from ${b.g}`} why={`${b.n} row${b.n > 1 ? "s" : ""}; the largest: ${b.text}`} /> : <span className="muted">-</span>}</td><td className="small muted">{b.text}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
