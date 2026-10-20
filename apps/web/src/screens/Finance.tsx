import { useState } from "react";
import { FINANCE, formatClock, lineAvailable, lcCommitted, COUNTERPARTIES, GRADES } from "@desk/engine";
import { useGame } from "../store";
import { Fig } from "../components/Fig";

export function Finance() {
  const state = useGame((g) => g.state);
  const submit = useGame((g) => g.submit);
  const [amount, setAmount] = useState(1000000);
  if (!state) return <div className="panel"><h1>Finance</h1><p className="notyet">not yet: start a level from the Academy.</p></div>;
  const f = state.finance;
  const rate = state.world.baseRate + FINANCE.lineSpreadBp.value / 10000;
  return (
    <div className="grid cols-2">
      <div className="panel accent-cash" id="margin">
        <h2>Accounts</h2>
        <table><tbody>
          <tr><td>Cash USD</td><td className="num"><Fig v={f.cashUSD} fmt="usd" what="Cash in USD" why="The sum of every USD ledger row: capital, variation margin, margin moved to and from the clearer, fees, line draws and repayments, interest." /></td></tr>
          <tr><td>Cash EUR</td><td className="num"><Fig v={f.cashEUR} fmt="int" what="Cash in EUR" why={`EUR variation margin from TTF; valued at EURUSD ${state.factors.eurusd.toFixed(4)} for equity.`} /></td></tr>
          <tr><td>Margin held at the clearer</td><td className="num"><Fig v={f.marginAccount} fmt="usd" what="Initial margin held" why={`Required now: $${Math.round(f.marginRequired).toLocaleString()}; the engine moves cash to match at every fill and close.`} /></td></tr>
          <tr><td>Credit line drawn</td><td className="num"><Fig v={f.lineDrawn} fmt="usd" what="Drawn on the line" why={`Of a $${f.lineLimit.toLocaleString()} line${f.lineCut ? ", now cut after a covenant breach" : ""}. $${Math.round(f.autoDrawn).toLocaleString()} of it was drawn by the desk for margin and payments and repays itself when cash allows.`} /> <span className="muted small">of</span> <Fig v={f.lineLimit} fmt="usdK" what="Line limit" why="Set by the level's tier (stylised)." stylised /></td></tr>
          <tr><td>Committed to letters of credit</td><td className="num"><Fig v={lcCommitted(state)} fmt="usd" what="Face of open letters of credit" why="Each open LC holds its face off the line until the purchase invoice is paid." /></td></tr>
          <tr><td>Line available</td><td className="num"><Fig v={lineAvailable(state)} fmt="usd" what="What the line can still lend or commit" why={`Limit $${f.lineLimit.toLocaleString()} less drawn $${Math.round(f.lineDrawn).toLocaleString()} less LCs $${Math.round(lcCommitted(state)).toLocaleString()}${f.lineCut ? "; the line is cut" : ""}.`} /> {f.lineCut && <span className="badge bad">covenant breached: line cut</span>}</td></tr>
          <tr><td>Covenant</td><td className="num"><Fig v={state.risk.maxDrawdown / state.capital} fmt="pct" decimals={0} what="Drawdown as a share of capital" why={`The bank cuts the line when the drawdown from the peak exceeds ${Math.round(FINANCE.covenantDrawdown.value * 100)}% of capital (stylised).`} stylised /> <span className="muted small">of {Math.round(FINANCE.covenantDrawdown.value * 100)}%</span></td></tr>
          <tr><td>Interest paid this level</td><td className="num"><Fig v={f.interestAccrued} fmt="usd" what="Interest paid" why={`Daily on the drawn balance at ${(rate * 100).toFixed(2)}%: base ${(state.world.baseRate * 100).toFixed(2)}% plus ${FINANCE.lineSpreadBp.value} bp (stylised).`} stylised /></td></tr>
          <tr><td>Margin call</td><td className="num">{f.marginCall ? <span className="neg">{"$" + Math.round(f.marginCall.amount).toLocaleString()} due {formatClock(state.startDay, f.marginCall.dueTick)}</span> : <span className="muted">none</span>}</td></tr>
        </tbody></table>
        <div className="flex" style={{ marginTop: 8 }}>
          <input aria-label="amount in USD" type="number" step={100000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={{ width: 140 }} />
          <button onClick={() => submit({ type: "draw_line", player: "p1", amount })} disabled={!state.level.unlockedActions.includes("draw_line")}>Draw</button>
          <button onClick={() => submit({ type: "repay_line", player: "p1", amount })} disabled={!state.level.unlockedActions.includes("repay_line")}>Repay</button>
          {f.marginCall && <button className="danger" onClick={() => submit({ type: "post_margin", player: "p1", amount: f.marginCall!.amount })}>Meet the call from the line</button>}
          <button onClick={() => submit({ type: "convert_fx", player: "p1", eur: -f.cashEUR })} disabled={Math.abs(f.cashEUR) < 1 || !state.level.unlockedActions.includes("convert_fx")}>Sell EUR balance</button>
        </div>
        <div id="lcs" style={{ marginTop: 10 }}>
          <h2>Letters of credit</h2>
          {state.lcs.length === 0 ? <div className="muted small">None open. A seller who wants one says so on the tender; open it from the cargo card.</div> : (
            <table><thead><tr><th>LC</th><th>Cargo</th><th>Beneficiary</th><th className="num">Face</th><th className="num">Fee</th><th>Status</th></tr></thead>
              <tbody>{state.lcs.map((l) => { const c = state.cargoes.find((x) => x.id === l.cargoId); return <tr key={l.id}><td>{l.id}</td><td>{c ? `${GRADES[c.grade].name} ${c.id}` : l.cargoId}</td><td className="small">{COUNTERPARTIES[l.beneficiary]?.name}</td><td className="num"><Fig v={l.faceUsd} fmt="usd" what="Face" why="The amount the bank undertakes to pay against documents; held off the line while open." /></td><td className="num"><Fig v={l.feeUsd} fmt="usd" what="Fee" why={`${(FINANCE.lcFeePerQuarter.value * 100).toFixed(2)}% of face per quarter (stylised).`} stylised /></td><td><span className={`badge ${l.closedTick === null ? "warn" : "ok"}`}>{l.closedTick === null ? "open" : `closed ${formatClock(state.startDay, l.closedTick).slice(4)}`}</span></td></tr>; })}</tbody></table>
          )}
          <div className="small muted" style={{ marginTop: 6 }}>Insured cargoes: {state.cargoes.filter((c) => c.insured).map((c) => c.id).join(", ") || "none"}. Prepaid: {state.cargoes.filter((c) => c.prepaidUsd > 0).map((c) => `${c.id} ${"$" + Math.round(c.prepaidUsd).toLocaleString()}`).join(", ") || "none"}.</div>
        </div>
      </div>
      <div className="panel">
        <h2>Ledger <span className="muted">(every movement of cash)</span></h2>
        <div style={{ maxHeight: 480, overflow: "auto" }} tabIndex={0} aria-label="ledger rows">
          <table><thead><tr><th>When</th><th>Kind</th><th className="num">Amount</th><th>Note</th></tr></thead>
            <tbody>{[...f.ledger].reverse().slice(0, 300).map((r) => <tr key={r.id}><td className="small">{formatClock(state.startDay, r.tick).slice(4)}</td><td className="small">{r.kind.replace("_", " ")}</td><td className="num"><Fig v={r.amount} fmt="usd" sign what={`${r.kind.replace("_", " ")} (${r.currency})`} why={r.text} at={r.tick} /></td><td className="small muted">{r.text}</td></tr>)}</tbody></table>
        </div>
      </div>
    </div>
  );
}
