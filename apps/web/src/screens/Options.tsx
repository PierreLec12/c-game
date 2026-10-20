/**
 * Options on the book (level 16): the chain of listed strikes for a month, an option ticket that shows what the fill
 * would do before the click, and a strategy builder whose legs come from the engine. The panel reads the engine and
 * submits option_order and option_strategy; nothing is priced here.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ckey, estimateOptionFill, formatClock, INSTRUMENTS, listedStrikes, monthLabel, optionExpiryTick, optionQuote, strategyLegs, STRATEGY_STRIKES, type Action, type InstrumentId, type LegTag, type OptionKind, type OptionQuote, type State } from "@desk/engine";
import { useGame } from "../store";
import { Fig } from "../components/Fig";

type Strategy = keyof typeof STRATEGY_STRIKES;
const STRATEGY_LABEL: Record<Strategy, string> = { collar: "Collar (buy a put, sell a call)", put_spread: "Put spread", call_spread: "Call spread", straddle: "Straddle", strangle: "Strangle" };

export function OptionsPanel({ state, inst }: { state: State; inst: InstrumentId }) {
  if (!state.level.unlockedActions.includes("option_order")) {
    return (
      <div className="panel" id="options" style={{ gridColumn: "1 / -1" }}>
        <h2>Options</h2>
        <div className="notyet">not yet: options unlock at level 16 (Options). Until then the vol surface below is read, not traded.</div>
      </div>
    );
  }
  return <OptionsBody state={state} inst={inst} />;
}

function OptionsBody({ state, inst }: { state: State; inst: InstrumentId }) {
  const submit = useGame((g) => g.submit);
  const selected = useGame((g) => g.selected);
  const refusals = useGame((g) => g.refusals);
  const spec = INSTRUMENTS[inst];
  const months = state.listed[inst].filter((m) => optionExpiryTick(state, inst, m) > state.tick);
  const [monthPick, setMonthPick] = useState<string | null>(null);
  const month = monthPick && months.includes(monthPick) ? monthPick : selected?.inst === inst && months.includes(selected.month) ? selected.month : months[0];
  const strikes = useMemo(() => (month ? listedStrikes(state, inst, month) : []), [state, inst, month]);
  const fwd = month ? state.quotes[ckey(inst, month)]?.mid : undefined;
  const atm = strikes.length && fwd !== undefined ? strikes.reduce((a, s) => (Math.abs(s - fwd) < Math.abs(a - fwd) ? s : a), strikes[0]) : null;
  const [ticket, setTicket] = useState<{ kind: OptionKind; strike: number | null; side: "buy" | "sell" }>({ kind: "call", strike: null, side: "buy" });
  const [qty, setQty] = useState(1);
  const [tag, setTag] = useState<LegTag>("option");
  const strike = ticket.strike !== null && strikes.includes(ticket.strike) ? ticket.strike : atm;
  const running = state.level.status === "running";
  // a long chain opens centred on the forward: scroll the container, not the page
  const chainRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = chainRef.current;
    const row = box?.querySelector<HTMLTableRowElement>("tr[data-atm]");
    if (box && row) box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 2);
  }, [inst, month, atm]);
  const lastRefusal = [...refusals].reverse().find((r) => r.action.type === "option_order" || r.action.type === "option_strategy");
  const fx = spec.currency === "EUR" ? state.factors.eurusd : 1;
  const lotUsd = spec.lot * fx;
  const est = useMemo(() => (month && strike !== null ? estimateOptionFill(state, inst, month, ticket.kind, strike, ticket.side, qty) : null), [state, inst, month, ticket.kind, ticket.side, strike, qty]);
  const q = est?.quote ?? null;
  const sign = ticket.side === "buy" ? 1 : -1;
  if (!month) {
    return <div className="panel" id="options" style={{ gridColumn: "1 / -1" }}><h2>Options on {spec.name}</h2><div className="notyet">not yet: every listed option on {spec.name} has expired; the next month lists at the roll.</div></div>;
  }
  const place = () => {
    if (strike === null) return;
    const a: Action = { type: "option_order", player: "p1", inst, month, strike, kind: ticket.kind, side: ticket.side, qty, tag };
    submit(a);
  };
  const cell = (k: number, kind: OptionKind, oq: OptionQuote | null, which: "bid" | "ask" | "iv" | "delta") => {
    const side: "buy" | "sell" = which === "bid" ? "sell" : "buy";
    const v = oq ? (which === "iv" ? oq.iv : which === "delta" ? oq.greeks?.delta ?? null : oq[which]) : null;
    const what = `${spec.name} ${monthLabel(month)} ${k} ${kind} ${which === "iv" ? "implied vol" : which === "delta" ? "delta" : which}`;
    const on = strike === k && ticket.kind === kind;
    return (
      <td className={`num clickable ${on ? "selected" : ""}`} onClick={() => setTicket({ kind, strike: k, side })} title={`load the ticket: ${side} the ${k} ${kind}`}>
        {oq ? <Fig v={v} fmt={which === "iv" ? "pct" : "px"} decimals={which === "iv" ? 1 : which === "delta" ? 2 : spec.decimals} what={what} why={which === "delta" ? `Change in the option's value per unit move in the future; ${oq.why}` : oq.why} notYet="At expiry the option has no Greeks: it is worth its intrinsic value." /> : <Fig v={null} what={what} notYet="No market: the option has expired." />}
      </td>
    );
  };
  return (
    <div className="panel accent-gas" id="options" style={{ gridColumn: "1 / -1" }}>
      <div className="flex">
        <h2 style={{ margin: 0 }}>Options on {spec.name} <span className="muted">(futures-style: no premium at the fill, the value settles daily; stylised)</span></h2>
        <span className="spacer" />
        <label className="small muted">Month <select aria-label="option month" value={month} onChange={(e) => setMonthPick(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)} (expires {formatClock(state.startDay, optionExpiryTick(state, inst, m)).slice(0, 14)})</option>)}</select></label>
      </div>
      <div className="grid options" style={{ marginTop: 8 }}>
        <div ref={chainRef} style={{ overflow: "auto", maxHeight: 420, position: "relative" }} tabIndex={0} aria-label="option chain">
          <table id="chain">
            <thead><tr><th className="num">Call bid</th><th className="num">Call ask</th><th className="num">IV</th><th className="num">Delta</th><th className="num">Strike</th><th className="num">Put bid</th><th className="num">Put ask</th><th className="num">IV</th><th className="num">Delta</th></tr></thead>
            <tbody>
              {strikes.map((k) => {
                const c = optionQuote(state, inst, month, "call", k);
                const p = optionQuote(state, inst, month, "put", k);
                return (
                  <tr key={k} className={k === strike ? "selected" : ""} data-atm={k === atm ? "" : undefined}>
                    {cell(k, "call", c, "bid")}{cell(k, "call", c, "ask")}{cell(k, "call", c, "iv")}{cell(k, "call", c, "delta")}
                    <td className="num" style={{ fontWeight: 600 }}>{k.toFixed(spec.decimals)}{k === atm && <span className="badge">ATM</span>}</td>
                    {cell(k, "put", p, "bid")}{cell(k, "put", p, "ask")}{cell(k, "put", p, "iv")}{cell(k, "put", p, "delta")}
                  </tr>
                );
              })}
              {strikes.length === 0 && <tr><td colSpan={9} className="notyet">not yet: no strikes listed on this month</td></tr>}
            </tbody>
          </table>
          <div className="small muted" style={{ marginTop: 4 }}>Click a bid to load a sale, an ask to load a purchase. Forward {fwd !== undefined ? fwd.toFixed(spec.decimals) : "?"}; depth {q ? q.depth : "?"} lots a strike.</div>
        </div>
        <div>
          <div className="ticket" id="option-ticket">
            <div className="row">
              <strong>{spec.name} {monthLabel(month)} {strike !== null ? strike.toFixed(spec.decimals) : "?"} {ticket.kind}</strong>
              <span>{q ? <>bid <Fig v={q.bid} fmt="px" decimals={spec.decimals} what="Option bid" why={q.why} /> · ask <Fig v={q.ask} fmt="px" decimals={spec.decimals} what="Option ask" why={q.why} /> · vol <Fig v={q.iv} fmt="pct" decimals={1} what="Implied vol" why={q.why} /></> : <span className="notyet">not yet</span>}</span>
              {q && !q.open && <span className="badge warn">market closed</span>}
            </div>
            <div className="row">
              <label>Kind<select aria-label="option kind" value={ticket.kind} onChange={(e) => setTicket({ ...ticket, kind: e.target.value as OptionKind })}><option value="call">Call</option><option value="put">Put</option></select></label>
              <label>Strike<select aria-label="strike" value={strike ?? ""} onChange={(e) => setTicket({ ...ticket, strike: Number(e.target.value) })}>{strikes.map((k) => <option key={k} value={k}>{k.toFixed(spec.decimals)}{k === atm ? " (ATM)" : ""}</option>)}</select></label>
              <label>Side<select aria-label="option side" value={ticket.side} onChange={(e) => setTicket({ ...ticket, side: e.target.value as "buy" | "sell" })}><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
              <label>Lots<input id="option-qty" aria-label="option lots" type="number" min={1} step={1} value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} style={{ width: 70 }} /></label>
              <label>Tag<select aria-label="option tag" value={tag} onChange={(e) => setTag(e.target.value as LegTag)}><option value="option">Option</option><option value="hedge">Hedge</option><option value="outright">Outright</option><option value="signal">Signal</option></select></label>
            </div>
            {est && (
              <div className="preview" aria-label="what the option order would do">
                <span className="muted">Estimated fill</span><span>{est.refusal && !est.quote?.open ? <span className="neg">{est.refusal}</span> : <Fig v={est.price} fmt="px" decimals={spec.decimals} what="Estimated fill price" why={`The ${ticket.side === "buy" ? "ask" : "bid"} plus slippage of ${est.slippage.toFixed(spec.decimals)} for ${qty} lots against ${q?.depth ?? "?"} lots of depth (half the vol spread per depth consumed, stylised).`} />}</span>
                <span className="muted">Slippage</span><span><Fig v={est.slippage * qty * lotUsd} fmt="usd" what="Slippage in dollars" why={`${est.slippage.toFixed(spec.decimals)} ${spec.unit} x ${qty} lots x ${spec.lot.toLocaleString()} ${spec.lotUnit}${fx !== 1 ? ` x EURUSD ${fx.toFixed(4)}` : ""}.`} /></span>
                <span className="muted">Fees</span><span><Fig v={est.fees} fmt="usd" what="Exchange and clearing fees" why={`$${spec.fee.value.toFixed(2)} a lot (stylised) x ${qty}.`} stylised /></span>
                <span className="muted">Notional</span><span><Fig v={est.notional} fmt="usdK" what="Notional at the model mid" why="Option mid x lots x lot size, in USD: nothing is paid now; the value settles daily as variation margin." /></span>
                <span className="muted">Delta-equivalent lots</span><span><Fig v={q?.greeks ? q.greeks.delta * qty * sign : null} fmt="signed" decimals={2} what="Delta-equivalent futures lots" why={`Delta ${q?.greeks ? q.greeks.delta.toFixed(2) : "?"} x ${qty} lots${ticket.side === "sell" ? ", short" : ""}: what this position adds to the futures net. Gamma ${q?.greeks ? q.greeks.gamma.toFixed(4) : "?"}, vega ${q?.greeks ? q.greeks.vega.toFixed(3) : "?"} a vol point, theta ${q?.greeks ? q.greeks.theta.toFixed(4) : "?"} a day, per lot.`} notYet="At expiry the option has no Greeks." /></span>
                <span className="muted">Expiry</span><span className="small mono">{q ? formatClock(state.startDay, q.expiryTick) : "not yet"} <span className="muted">({q ? Math.floor((q.expiryTick - state.tick) / 24) : "?"} days; three business days before the future, stylised)</span></span>
              </div>
            )}
            <div className="row">
              <button className="primary" id="option-submit" onClick={place} disabled={!running || strike === null}>{ticket.side === "buy" ? "Buy" : "Sell"} {qty} {ticket.kind}{qty > 1 ? "s" : ""}</button>
              {refusalsFor(lastRefusal)}
            </div>
            <LastOptionFill />
          </div>
          <StrategyBuilder state={state} inst={inst} month={month} strikes={strikes} atm={atm} lotUsd={lotUsd} />
        </div>
      </div>
    </div>
  );
}

function refusalsFor(r: { reason: string } | undefined) {
  return r ? <span className="refusal" role="alert">Refused: {r.reason}</span> : null;
}

/** The last option fill, where the click was. */
function LastOptionFill() {
  const feed = useGame((g) => g.feed);
  const last = [...feed].reverse().find((f) => (f.kind === "fill" && f.data?.option !== undefined) || f.kind === "option");
  if (!last) return null;
  return <div className="small" style={{ color: "var(--teal)" }} role="status">{last.text}</div>;
}

function StrategyBuilder({ state, inst, month, strikes, atm, lotUsd }: { state: State; inst: InstrumentId; month: string; strikes: number[]; atm: number | null; lotUsd: number }) {
  const submit = useGame((g) => g.submit);
  const spec = INSTRUMENTS[inst];
  const [name, setName] = useState<Strategy>("collar");
  const [picked, setPicked] = useState<number[]>([]);
  const [qty, setQty] = useState(1);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const need = STRATEGY_STRIKES[name];
  const defaults = useMemo(() => {
    if (atm === null) return [];
    const i = strikes.indexOf(atm);
    return need === 1 ? [atm] : [strikes[Math.max(0, i - 2)], strikes[Math.min(strikes.length - 1, i + 2)]];
  }, [atm, strikes, need]);
  const chosen = picked.length === need && picked.every((s) => strikes.includes(s)) ? picked : defaults;
  const legs = chosen.length === need ? strategyLegs(name, chosen, side) : [];
  const legEst = legs.map((l) => ({ leg: l, est: estimateOptionFill(state, inst, month, l.kind, l.strike, l.side, qty) }));
  const net = legEst.reduce((a, { leg, est }) => a + (leg.side === "buy" ? 1 : -1) * est.price, 0);
  const slip = legEst.reduce((a, { est }) => a + est.slippage * qty * lotUsd, 0);
  const fees = legEst.reduce((a, { est }) => a + est.fees, 0);
  const delta = legEst.reduce((a, { leg, est }) => a + (est.quote?.greeks?.delta ?? 0) * qty * (leg.side === "buy" ? 1 : -1), 0);
  const refusal = legEst.find(({ est }) => est.refusal)?.est.refusal ?? null;
  const running = state.level.status === "running";
  const place = () => submit({ type: "option_strategy", player: "p1", name, inst, month, strikes: chosen, qty, side });
  return (
    <div className="ticket" id="strategy" style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
      <div className="row"><strong>Strategy</strong><span className="muted small">the legs come from the engine; one package, one tag</span></div>
      <div className="row">
        <label>Package<select aria-label="strategy" value={name} onChange={(e) => { setName(e.target.value as Strategy); setPicked([]); }}>{(Object.keys(STRATEGY_LABEL) as Strategy[]).map((s) => <option key={s} value={s}>{STRATEGY_LABEL[s]}</option>)}</select></label>
        {Array.from({ length: need }, (_, i) => (
          <label key={i}>{need === 1 ? "Strike" : i === 0 ? "Lower strike" : "Upper strike"}<select aria-label={need === 1 ? "strategy strike" : i === 0 ? "lower strike" : "upper strike"} value={chosen[i] ?? ""} onChange={(e) => { const next = [...chosen]; next[i] = Number(e.target.value); setPicked(next); }}>{strikes.map((k) => <option key={k} value={k}>{k.toFixed(spec.decimals)}</option>)}</select></label>
        ))}
        <label>Side<select aria-label="strategy side" value={side} onChange={(e) => setSide(e.target.value as "buy" | "sell")}><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
        <label>Lots<input aria-label="strategy lots" type="number" min={1} step={1} value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} style={{ width: 70 }} /></label>
      </div>
      {legs.length > 0 && (
        <table>
          <thead><tr><th>Leg</th><th className="num">Fill</th><th className="num">Delta</th><th className="num">Vol</th></tr></thead>
          <tbody>{legEst.map(({ leg, est }) => <tr key={`${leg.kind}${leg.strike}`}><td>{leg.side} {qty} {leg.strike.toFixed(spec.decimals)} {leg.kind}</td><td className="num">{est.refusal && !est.quote ? <span className="neg small">{est.refusal}</span> : <Fig v={est.price} fmt="px" decimals={spec.decimals} what={`${leg.side} ${leg.strike} ${leg.kind}: estimated fill`} why={est.quote?.why} />}</td><td className="num"><Fig v={est.quote?.greeks ? est.quote.greeks.delta * (leg.side === "buy" ? 1 : -1) : null} fmt="signed" decimals={2} what="Leg delta per lot, signed by side" why="A bought leg carries the option's delta; a sold leg the opposite." notYet="At expiry the option has no Greeks." /></td><td className="num"><Fig v={est.quote?.iv ?? null} fmt="pct" decimals={1} what="Implied vol of the leg" why={est.quote?.why} /></td></tr>)}</tbody>
        </table>
      )}
      {legs.length > 0 && (
        <div className="preview" aria-label="what the strategy would do">
          <span className="muted">Net premium per lot</span><span><Fig v={net} fmt="signed" decimals={spec.decimals} what="Net premium of the package per lot" why={`Bought legs minus sold legs at their estimated fills: ${legEst.map(({ leg, est }) => `${leg.side === "buy" ? "+" : "-"}${est.price.toFixed(spec.decimals)}`).join(" ")}. Positive is paid (as daily variation margin, not up front).`} /></span>
          <span className="muted">Net in dollars</span><span><Fig v={net * qty * lotUsd} fmt="usd" sign what="Net premium in dollars" why={`${net.toFixed(spec.decimals)} x ${qty} lots x ${spec.lot.toLocaleString()} ${spec.lotUnit}; negative is premium received.`} /></span>
          <span className="muted">Slippage and fees</span><span><Fig v={slip + fees} fmt="usd" what="Slippage and fees across the legs" why={`Slippage $${Math.round(slip).toLocaleString()} plus fees $${Math.round(fees).toLocaleString()} ($${spec.fee.value.toFixed(2)} a lot a leg, stylised).`} stylised /></span>
          <span className="muted">Net delta lots</span><span><Fig v={delta} fmt="signed" decimals={2} what="Delta-equivalent lots of the package" why="The sum of the legs' deltas, signed by side, times the lots." /></span>
        </div>
      )}
      <div className="row">
        <button className="primary" id="strategy-submit" onClick={place} disabled={!running || legs.length === 0 || (need === 2 && chosen[0] === chosen[1])}>{side === "buy" ? "Buy" : "Sell"} {qty} {name.replace("_", " ")}{qty > 1 ? "s" : ""}</button>
        {need === 2 && chosen[0] === chosen[1] && <span className="refusal">the two strikes must differ</span>}
        {refusal && legs.length > 0 && <span className="small muted">{refusal}</span>}
      </div>
    </div>
  );
}
