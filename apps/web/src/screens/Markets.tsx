import { useMemo, useState } from "react";
import { ckey, estimateFill, fullCarry, impliedVolAt, INSTRUMENTS, marginRequired, monthLabel, type Action, type InstrumentId, type LegTag, type State } from "@desk/engine";
import { LEVELS, PLANNED_TITLES } from "@desk/content";
import { useGame } from "../store";
import { Fig } from "../components/Fig";
import { Curve } from "../charts/Curve";

const ALL: InstrumentId[] = ["BRENT", "WTI", "DUBAI", "RBOB", "ULSD", "HH", "TTF"];
const UNLOCK_LEVEL: Record<InstrumentId, number> = { BRENT: 0, WTI: 3, RBOB: 3, ULSD: 3, HH: 15, TTF: 15, DUBAI: 7 };
const COLOUR: Record<InstrumentId, string> = { BRENT: "var(--crude)", WTI: "var(--crude)", RBOB: "var(--products)", ULSD: "var(--teal)", HH: "var(--gas)", TTF: "var(--lng)", DUBAI: "var(--freight)" };

export function Markets() {
  const state = useGame((g) => g.state);
  const selected = useGame((g) => g.selected);
  const select = useGame((g) => g.select);
  if (!state) return <div className="panel"><h1>Markets</h1><p className="notyet">not yet: start a level from the Academy.</p></div>;
  const inst = (selected?.inst ?? state.level.instruments[0]) as InstrumentId;
  const spec = INSTRUMENTS[inst];
  const months = state.listed[inst];
  const points = months.map((m) => { const q = state.quotes[ckey(inst, m)]; const c = state.contracts[ckey(inst, m)]; return { month: m, mid: q.mid, settle: c.settle ? c.settle.v : null, bid: q.bid, ask: q.ask }; });
  return (
    <div className="grid markets">
      <div className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="flex">
          {ALL.map((i) => {
            const on = state.level.instruments.includes(i);
            return <button key={i} className={i === inst ? "active" : ""} disabled={!on} title={on ? INSTRUMENTS[i].name : `not yet: ${INSTRUMENTS[i].name} unlocks at level ${UNLOCK_LEVEL[i]} (${PLANNED_TITLES[UNLOCK_LEVEL[i]] ?? LEVELS[UNLOCK_LEVEL[i]]?.title ?? ""})`} onClick={() => select(i, state.listed[i][0])}>{INSTRUMENTS[i].name}{!on && <span className="badge">L{UNLOCK_LEVEL[i]}</span>}</button>;
          })}
        </div>
      </div>
      <div className="panel" id="curve">
        <h2>{spec.name} curve <span className="muted">({spec.unit}, {spec.lot.toLocaleString()} {spec.lotUnit} a lot, tick {spec.tick})</span></h2>
        <Curve points={points} unit={spec.unit} decimals={spec.decimals} colour={COLOUR[inst]} />
        <table>
          <thead><tr><th>Month</th><th>Code</th><th className="num">Bid</th><th className="num">Ask</th><th className="num">Mid</th><th className="num">Settle</th><th className="num">Depth</th><th className="num">Spread</th><th className="num">Expiry</th></tr></thead>
          <tbody>
            {months.map((m, i) => {
              const q = state.quotes[ckey(inst, m)];
              const c = state.contracts[ckey(inst, m)];
              return (
                <tr key={m} className={`clickable ${selected?.month === m && selected.inst === inst ? "selected" : ""}`} onClick={() => select(inst, m)}>
                  <td>{monthLabel(m)}{i === 0 && <span className="badge">front</span>}</td>
                  <td className="muted">{c.code}</td>
                  <td className="num"><Fig v={q.bid} fmt="px" decimals={spec.decimals} what={`${spec.name} ${monthLabel(m)} bid`} why={q.why} at={q.at} /></td>
                  <td className="num"><Fig v={q.ask} fmt="px" decimals={spec.decimals} what={`${spec.name} ${monthLabel(m)} ask`} why={q.why} at={q.at} /></td>
                  <td className="num"><Fig v={q.mid} fmt="px" decimals={spec.decimals} what={`${spec.name} ${monthLabel(m)} mid`} why={q.why} at={q.at} /></td>
                  <td className="num">{c.settle ? <Fig v={c.settle.v} fmt="px" decimals={spec.decimals} what={`${spec.name} ${monthLabel(m)} settle`} why={c.settle.why} at={c.settle.at} /> : <Fig v={null} what="Settle" notYet="No session has closed yet this level; the first settle is at 19:00." />}</td>
                  <td className="num"><Fig v={q.depth} fmt="int" what="Depth at the touch (lots each side)" why={q.why} at={q.at} /></td>
                  <td className="num"><Fig v={q.spreadTicks} fmt="int" what="Bid-ask spread in ticks" why={q.why} at={q.at} /></td>
                  <td className="num small muted">{Math.floor((c.expiryTick - state.tick) / 24)}d</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div>
        <Ticket state={state} inst={inst} />
        <Orders state={state} />
      </div>
      <div className="panel" id="spreads"><Spreads state={state} /></div>
      <div className="panel" id="vol"><VolSurface state={state} /></div>
    </div>
  );
}

function Spreads({ state }: { state: State }) {
  const q = (i: InstrumentId, k: number) => state.quotes[ckey(i, state.listed[i][k])];
  const rows: { name: string; v: number | null; unit: string; why: string; show: boolean; decimals: number }[] = [];
  const has = (i: InstrumentId) => state.level.instruments.includes(i);
  for (const i of ALL) {
    const spec = INSTRUMENTS[i];
    rows.push({ name: `${spec.name} M1-M2`, v: has(i) ? q(i, 1).mid - q(i, 0).mid : null, unit: `${spec.unit}/month`, decimals: spec.decimals, why: `Second month mid minus front mid${has(i) ? `: ${q(i, 1).mid.toFixed(spec.decimals)} - ${q(i, 0).mid.toFixed(spec.decimals)}` : ""}. Positive is contango; full carry here is about ${has(i) ? fullCarry(i, q(i, 0).mid, state.world.baseRate).toFixed(spec.decimals) : "?"} (storage plus financing at ${(state.world.baseRate * 100).toFixed(2)}%, stylised).`, show: has(i) });
  }
  rows.push({ name: "Brent - WTI (front)", v: has("WTI") ? q("BRENT", 0).mid - q("WTI", 0).mid : null, unit: "$/bbl", decimals: 2, why: "Front Brent mid minus front WTI mid. The stylised cost of moving a barrel from Houston to Rotterdam is about $3.00; the arb closes the spread above that.", show: has("WTI") });
  if (has("RBOB") && has("ULSD") && has("WTI")) {
    const rb = q("RBOB", 0).mid * 42, ho = q("ULSD", 0).mid * 42, cl = q("WTI", 0).mid;
    rows.push({ name: "3-2-1 crack", v: (2 * rb + ho - 3 * cl) / 3, unit: "$/bbl", decimals: 2, why: `(2 x RBOB ${rb.toFixed(2)} + ULSD ${ho.toFixed(2)} - 3 x WTI ${cl.toFixed(2)}) / 3, products converted at 42 gal/bbl.`, show: true });
    rows.push({ name: "Gasoline crack", v: rb - cl, unit: "$/bbl", decimals: 2, why: `RBOB ${rb.toFixed(2)} $/bbl minus WTI ${cl.toFixed(2)}.`, show: true });
    rows.push({ name: "Diesel crack", v: ho - cl, unit: "$/bbl", decimals: 2, why: `ULSD ${ho.toFixed(2)} $/bbl minus WTI ${cl.toFixed(2)}.`, show: true });
  }
  rows.push({ name: "Dated Brent - front", v: state.factors.datedDiff, unit: "$/bbl", decimals: 2, why: "The daily physical assessment minus the front future: rises with prompt tightness, published once a day (stylised).", show: state.level.tier >= 2 });
  rows.push({ name: "Brent - Dubai (EW)", v: state.factors.dubaiEW, unit: "$/bbl", decimals: 2, why: "The East-West spread: moves with the geopolitics index and the Gulf loading programme (stylised).", show: state.level.tier >= 2 });
  rows.push({ name: "EURUSD", v: state.factors.eurusd, unit: "", decimals: 4, why: "A slow random walk; the TTF book carries an FX leg.", show: true });
  return (
    <>
      <h2>Spreads and cracks</h2>
      <table><thead><tr><th>Spread</th><th className="num">Value</th><th>Unit</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.name}><td>{r.name}</td><td className="num">{r.show ? <Fig v={r.v} fmt="signed" decimals={r.decimals} what={r.name} why={r.why} /> : <Fig v={null} what={r.name} notYet="This instrument is not listed in this level yet." />}</td><td className="muted small">{r.unit}</td></tr>)}</tbody></table>
    </>
  );
}

function VolSurface({ state }: { state: State }) {
  const tenors = [1, 3, 6, 12];
  return (
    <>
      <h2>Vol surface <span className="muted">(model implied vol, annualised)</span></h2>
      <table><thead><tr><th>Instrument</th>{tenors.map((t) => <th key={t} className="num">{t}m ATM</th>)}<th className="num">10% put skew</th></tr></thead>
        <tbody>{ALL.filter((i) => state.level.instruments.includes(i)).map((i) => {
          const f = state.factors.vol[i];
          return <tr key={i}><td>{INSTRUMENTS[i].name}</td>{tenors.map((t) => <td key={t} className="num"><Fig v={impliedVolAt(f, t)} fmt="pct" decimals={1} what={`${INSTRUMENTS[i].name} ${t}-month at-the-money implied vol`} why={`Regime ${state.world.regime} base vol times the instrument multiple, raised by the geopolitics index (${state.world.geo.toFixed(2)}), event intensity (${state.world.eventIntensity.toFixed(2)}) and a known release ahead; a mild downward term structure (stylised).`} /></td>)}<td className="num"><Fig v={impliedVolAt(f, 1, -0.1) - impliedVolAt(f, 1)} fmt="pct" decimals={1} what="Put skew" why="Vol points added for a put 10% below the forward: puts are richer (stylised)." /></td></tr>;
        })}</tbody></table>
      <div className="muted small">Options trade from level 16; until then the surface is read, not traded.</div>
    </>
  );
}

export function Ticket({ state, inst }: { state: State; inst: InstrumentId }) {
  const submit = useGame((g) => g.submit);
  const selected = useGame((g) => g.selected);
  const refusals = useGame((g) => g.refusals);
  const [tab, setTab] = useState<"outright" | "spread" | "roll">("outright");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState(1);
  const [kind, setKind] = useState<"market" | "limit" | "stop">("market");
  const [price, setPrice] = useState("");
  const [spreadName, setSpreadName] = useState<"time" | "inter" | "crack321">("time");
  const [leg2Inst, setLeg2Inst] = useState<InstrumentId>("WTI");
  const [tag, setTag] = useState<LegTag>(state.cargoes.length > 0 ? "hedge" : "outright");
  const spec = INSTRUMENTS[inst];
  const month = selected?.inst === inst && selected.month ? selected.month : state.listed[inst][0];
  const est = useMemo(() => estimateFill(state, inst, month, side, qty), [state, inst, month, side, qty]);
  const q = est.quote;
  const marginNow = state.finance.marginRequired;
  const marginAfter = useMemo(() => {
    if (!q) return marginNow;
    const probe: State = { ...state, lots: [...state.lots, { id: "probe", inst, month, qty: side === "buy" ? qty : -qty, entry: q.mid, openedTick: state.tick, tag: "outright", base: {}, baseFx: state.factors.eurusd, lastMark: q.mid }] };
    return marginRequired(probe).total;
  }, [state, inst, month, side, qty, q, marginNow]);
  const lastRefusal = refusals[refusals.length - 1];
  const canSpread = state.level.unlockedActions.includes("spread");
  const canRoll = state.level.unlockedActions.includes("roll");
  const place = () => {
    const a: Action = { type: "order", player: "p1", inst, month, side, qty, kind, price: kind === "market" ? undefined : parseFloat(price), tag };
    submit(a);
  };
  const placeSpread = () => {
    const m1 = month, m2 = state.listed[inst][state.listed[inst].indexOf(month) + 1] ?? state.listed[inst][1];
    const other = side === "buy" ? "sell" : "buy";
    let a: Action;
    if (spreadName === "time") a = { type: "spread", player: "p1", name: "time", legs: [{ inst, month: m1, side, qty }, { inst, month: m2, side: other, qty }] };
    else if (spreadName === "inter") a = { type: "spread", player: "p1", name: "inter", legs: [{ inst, month: m1, side, qty }, { inst: leg2Inst, month: state.listed[leg2Inst][0], side: other, qty }] };
    else a = { type: "spread", player: "p1", name: "crack321", legs: [{ inst: "RBOB", month: state.listed.RBOB[0], side, qty: 2 * qty }, { inst: "ULSD", month: state.listed.ULSD[0], side, qty }, { inst: "WTI", month: state.listed.WTI[0], side: other, qty: 3 * qty }] };
    submit(a);
  };
  const net = state.lots.filter((l) => l.inst === inst && l.month === month).reduce((a, l) => a + l.qty, 0);
  const nextMonth = state.listed[inst][state.listed[inst].indexOf(month) + 1];
  return (
    <div className="panel accent-crude ticket" id="ticket">
      <div className="flex"><h2 style={{ margin: 0 }}>Order ticket</h2><span className="spacer" /><button className={tab === "outright" ? "active" : ""} onClick={() => setTab("outright")}>Outright</button><button className={tab === "spread" ? "active" : ""} disabled={!canSpread} title={canSpread ? "" : "not yet: spreads unlock at level 3"} onClick={() => setTab("spread")} id="ticket-spread">Spread</button><button className={tab === "roll" ? "active" : ""} disabled={!canRoll} title={canRoll ? "" : "not yet: the roll unlocks at level 2"} onClick={() => setTab("roll")}>Roll</button></div>
      <div className="row">
        <strong>{spec.name} {monthLabel(month)}</strong>
        <span id="ticket-touch">{q ? <>bid <Fig v={q.bid} fmt="px" decimals={spec.decimals} what="Bid" why={q.why} at={q.at} /> · ask <Fig v={q.ask} fmt="px" decimals={spec.decimals} what="Ask" why={q.why} at={q.at} /> · depth <Fig v={q.depth} fmt="int" what="Depth at the touch, lots each side" why={q.why} at={q.at} /></> : <span className="notyet">not yet</span>}</span>
        {!q?.open && <span className="badge warn">market closed</span>}
      </div>
      <div className="row">
        <label>Side<select aria-label="side" value={side} onChange={(e) => setSide(e.target.value as "buy" | "sell")}><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
        <label>Lots<input id="ticket-qty" aria-label="lots" type="number" min={1} step={1} value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} style={{ width: 80 }} /></label>
        {tab === "outright" && <label>Type<select aria-label="order type" value={kind} onChange={(e) => setKind(e.target.value as "market" | "limit" | "stop")}><option value="market">Market</option><option value="limit">Limit</option><option value="stop">Stop</option></select></label>}
        {tab === "outright" && kind !== "market" && <label>Price<input aria-label="price" type="number" step={spec.tick} value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 100 }} /></label>}
        {tab === "outright" && state.level.tier >= 2 && <label>Tag<select aria-label="tag" value={tag} onChange={(e) => setTag(e.target.value as LegTag)}><option value="outright">Outright</option><option value="hedge">Hedge</option></select></label>}
        {tab === "spread" && <label>Package<select aria-label="spread type" value={spreadName} onChange={(e) => setSpreadName(e.target.value as "time" | "inter" | "crack321")}><option value="time">Time spread (this month vs next)</option><option value="inter">Inter-commodity (vs another front)</option><option value="crack321" disabled={!state.level.instruments.includes("RBOB")}>3-2-1 crack (units)</option></select></label>}
        {tab === "spread" && spreadName === "inter" && <label>Against<select aria-label="second leg" value={leg2Inst} onChange={(e) => setLeg2Inst(e.target.value as InstrumentId)}>{ALL.filter((i) => i !== inst && state.level.instruments.includes(i)).map((i) => <option key={i} value={i}>{INSTRUMENTS[i].name}</option>)}</select></label>}
      </div>
      {tab === "outright" && (
        <div className="preview" aria-label="what the order would do">
          <span className="muted">Estimated fill</span><span>{est.refusal && kind === "market" ? <span className="neg">{est.refusal}</span> : <Fig v={est.price} fmt="px" decimals={spec.decimals} what="Estimated fill price" why={`The ${side === "buy" ? "ask" : "bid"} plus slippage of ${est.slippage.toFixed(spec.decimals)} for ${qty} lots against ${q?.depth ?? "?"} lots of depth (half a spread per depth consumed, stylised).`} />}</span>
          <span className="muted">Slippage</span><span><Fig v={est.slippage * qty * spec.lot * (spec.currency === "EUR" ? state.factors.eurusd : 1)} fmt="usd" what="Slippage in dollars" why={`${est.slippage.toFixed(spec.decimals)} ${spec.unit} x ${qty} lots x ${spec.lot.toLocaleString()} ${spec.lotUnit}.`} /></span>
          <span className="muted">Fees</span><span><Fig v={est.fees} fmt="usd" what="Exchange and clearing fees" why={`$${spec.fee.value.toFixed(2)} a lot (stylised) x ${qty}.`} stylised /></span>
          <span className="muted">Notional</span><span><Fig v={est.notional} fmt="usdK" what="Notional" why="Fill price x lots x lot size, in USD." /></span>
          <span className="muted">Margin impact</span><span><Fig v={marginAfter - marginNow} fmt="usd" sign what="Change in initial margin" why={`Initial margin after this fill ${Math.round(marginAfter).toLocaleString()} minus now ${Math.round(marginNow).toLocaleString()}: ${spec.initialMarginShare.value * 100}% of notional per instrument with spread offsets (stylised). Free cash ${Math.round(state.finance.cashUSD).toLocaleString()}; line available ${Math.round(state.finance.lineLimit - state.finance.lineDrawn).toLocaleString()}.`} stylised /></span>
          <span className="muted">Position after</span><span><Fig v={net + (side === "buy" ? qty : -qty)} fmt="lots" what="Net lots in this contract after the fill" why={`Now ${net} lots.`} /></span>
        </div>
      )}
      {tab === "spread" && <div className="preview"><span className="muted">Legs</span><span className="small">{spreadName === "time" ? `${side} ${qty} ${monthLabel(month)}, ${side === "buy" ? "sell" : "buy"} ${qty} ${nextMonth ? monthLabel(nextMonth) : "?"}` : spreadName === "inter" ? `${side} ${qty} ${spec.name}, ${side === "buy" ? "sell" : "buy"} ${qty} ${INSTRUMENTS[leg2Inst].name}` : `${side} ${2 * qty} RBOB + ${qty} ULSD, ${side === "buy" ? "sell" : "buy"} ${3 * qty} WTI`}</span><span className="muted">Margin</span><span className="small">Spread legs offset 70% (time) or 60% (inter-commodity) of initial margin, stylised.</span></div>}
      {tab === "roll" && <div className="preview"><span className="muted">Roll</span><span className="small">{net === 0 ? "no position in this month" : `${net > 0 ? "sell" : "buy"} ${Math.abs(net)} ${monthLabel(month)}, ${net > 0 ? "buy" : "sell"} ${Math.abs(net)} ${nextMonth ? monthLabel(nextMonth) : "?"}`}</span></div>}
      <div className="row">
        {tab === "outright" && <button className="primary" id="ticket-submit" onClick={place} disabled={state.level.status !== "running"}>{side === "buy" ? "Buy" : "Sell"} {qty} {kind}</button>}
        {tab === "spread" && <button className="primary" onClick={placeSpread} disabled={state.level.status !== "running"}>{side === "buy" ? "Buy" : "Sell"} {qty} {spreadName === "crack321" ? "crack unit" : "spread"}{qty > 1 ? "s" : ""}</button>}
        {tab === "roll" && <button className="primary" onClick={() => nextMonth && submit({ type: "roll", player: "p1", inst, from: month, to: nextMonth })} disabled={net === 0 || !nextMonth || state.level.status !== "running"}>Roll to {nextMonth ? monthLabel(nextMonth) : "?"}</button>}
        {net !== 0 && <button onClick={() => submit({ type: "close", player: "p1", inst, month })}>Close {Math.abs(net)} at market</button>}
      </div>
      {lastRefusal && <div className="refusal" role="alert">Refused: {lastRefusal.reason}</div>}
      <LastFill />
    </div>
  );
}

/** The fill after the click, where the click was. */
function LastFill() {
  const feed = useGame((g) => g.feed);
  const last = [...feed].reverse().find((f) => f.kind === "fill");
  if (!last) return null;
  return <div className="small" style={{ color: "var(--teal)" }} role="status">{last.text}</div>;
}

function Orders({ state }: { state: State }) {
  const submit = useGame((g) => g.submit);
  const resting = state.orders.filter((o) => o.status === "resting");
  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <h2>Open orders</h2>
      {resting.length === 0 ? <div className="muted small">none resting</div> : (
        <table><thead><tr><th>Id</th><th>Order</th><th className="num">Price</th><th></th></tr></thead>
          <tbody>{resting.map((o) => <tr key={o.id}><td>{o.id}</td><td>{o.kind} {o.side} {o.qty} {INSTRUMENTS[o.inst].name} {monthLabel(o.month)}</td><td className="num">{o.price}</td><td><button onClick={() => submit({ type: "cancel_order", player: "p1", orderId: o.id })}>Cancel</button></td></tr>)}</tbody></table>
      )}
    </div>
  );
}
