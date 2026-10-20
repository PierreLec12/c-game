import { useState } from "react";
import { Link } from "react-router-dom";
import { cargoMark, charterQuotes, COUNTERPARTIES, formatClock, GRADES, legMark, passageOptions, PORTS, physicalExposureBbl, windowText, VESSEL_CLASSES, type Cargo, type State, type Tender, type Voyage } from "@desk/engine";
import { useGame } from "../store";
import { Fig } from "../components/Fig";

const usd = (x: number) => (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString();

export function Desk() {
  const state = useGame((g) => g.state);
  if (!state) return <div className="panel"><h1>Desk</h1><p className="notyet">not yet: start a level from the Academy.</p></div>;
  if (!state.level.unlockedActions.includes("accept_tender")) return <div className="panel"><h1>Desk</h1><p className="notyet">not yet: tenders, cargoes and ships unlock at level 5, the first physical level.</p></div>;
  const open = state.tenders.filter((t) => t.status === "open");
  const closed = state.tenders.filter((t) => t.status !== "open").slice(-6).reverse();
  return (
    <div className="grid cols-2">
      <div className="panel accent-crude" id="tenders" style={{ gridColumn: "1 / -1" }}>
        <h2>Tenders and quotes <span className="muted">({open.length} open)</span></h2>
        {open.length === 0 ? <div className="muted">Nothing open. Offers and bids arrive on the clock; the Bridge calendar says when.</div> : open.map((t) => <TenderRow key={t.id} t={t} state={state} />)}
        {closed.length > 0 && <div className="small muted" style={{ marginTop: 8 }}>{closed.map((t) => <div key={t.id}>{t.id} {t.status}: {t.note}{t.status === "expired" && t.trap ? ` ${t.trap}` : ""}</div>)}</div>}
      </div>
      <div className="panel" id="cargoes" style={{ gridColumn: "1 / -1" }}>
        <h2>Cargoes <span className="muted">(net physical exposure <Fig v={physicalExposureBbl(state).bbl} fmt="int" what="Net unpriced physical barrels" why="Long on unpriced sales and unsold cargoes, short on unpriced purchases. The hedge should offset this number." /> bbl)</span></h2>
        {state.cargoes.length === 0 ? <div className="muted">No cargo yet. Accept an offer above.</div> : state.cargoes.map((c) => <CargoCard key={c.id} c={c} state={state} />)}
      </div>
      <div className="panel" id="vessels">
        <h2>Vessels</h2>
        <table><thead><tr><th>Ship</th><th>Class</th><th>Owner</th><th>Status</th><th>Where</th></tr></thead>
          <tbody>{state.vessels.filter((v) => v.cls !== "LNGC").map((v) => <tr key={v.id}><td>{v.name}</td><td>{VESSEL_CLASSES[v.cls].name}</td><td className="small">{COUNTERPARTIES[v.owner].name}</td><td>{v.status}</td><td className="small muted">{v.atPort ? PORTS[v.atPort].name : `${v.lat.toFixed(1)}, ${v.lon.toFixed(1)}`}</td></tr>)}</tbody></table>
      </div>
      <div className="panel">
        <h2>Tanks</h2>
        <div className="notyet">not yet: tank leases, fills and draws unlock at level 13 (milestone 3). Floating storage: hold a ship at anchor from its cargo card.</div>
        <h2 style={{ marginTop: 12 }}>Refinery and LNG</h2>
        <div className="notyet">not yet: level 14 and level 15 (milestone 4).</div>
      </div>
    </div>
  );
}

function TenderRow({ t, state }: { t: Tender; state: State }) {
  const submit = useGame((g) => g.submit);
  const [cargoId, setCargoId] = useState<string>(state.cargoes.find((c) => !c.sale && c.grade === t.grade)?.id ?? "");
  const cp = COUNTERPARTIES[t.counterparty];
  const hoursLeft = t.expiresTick - state.tick;
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
      <div className="flex">
        <strong>{t.side === "offer" ? "Offer" : "Bid"} {t.id}</strong>
        <span>{cp.name}<span className="badge">{cp.rating}</span></span>
        <span className="badge warn">closes in {hoursLeft}h</span>
      </div>
      <div className="small" style={{ margin: "4px 0" }}>{t.note}</div>
      <div className="small muted">
        {GRADES[t.grade].name} · {t.bbl.toLocaleString()} bbl · {t.incoterm} {PORTS[t.port].name} · {t.basis} <Fig v={t.diff} fmt="signed" what="Contract differential" why={`Over ${t.basis}. The market's fair differential on these terms is ${t.fairDiff >= 0 ? "+" : ""}${t.fairDiff.toFixed(2)} (grade grid${t.incoterm !== "FOB" ? " plus freight and insurance" : ""}); ${cp.name}'s profile: ${cp.profile}.`} /> · {windowText(t.window)} · {t.side === "offer" ? "laycan" : "discharge"} days {t.laycan[0]}-{t.laycan[1]}
      </div>
      <div className="flex" style={{ marginTop: 6 }}>
        {t.side === "bid" && <select aria-label="cargo to sell" value={cargoId} onChange={(e) => setCargoId(e.target.value)}><option value="">pick a cargo</option>{state.cargoes.filter((c) => !c.sale).map((c) => <option key={c.id} value={c.id}>{c.id} {GRADES[c.grade].name} {c.bbl.toLocaleString()} bbl</option>)}</select>}
        <button className="primary" onClick={() => submit({ type: "accept_tender", player: "p1", tenderId: t.id, cargoId: t.side === "bid" ? cargoId : undefined })} disabled={state.level.status !== "running" || (t.side === "bid" && !cargoId)}>Accept</button>
        <button onClick={() => submit({ type: "decline_tender", player: "p1", tenderId: t.id })}>Decline</button>
      </div>
    </div>
  );
}

function WindowBar({ state, c, which }: { state: State; c: Cargo; which: "purchase" | "sale" }) {
  const leg = which === "purchase" ? c.purchase : c.sale;
  if (!leg) return <span className="notyet">not yet: unsold</span>;
  const m = legMark(state, c, leg);
  const days = leg.windowDays ?? m.unpriced;
  const today = Math.floor(state.tick / 24);
  return (
    <span className="small">
      {which}: {leg.basis} {leg.diff >= 0 ? "+" : ""}{leg.diff.toFixed(2)} · {windowText(leg.window)} ·{" "}
      {days.map((d) => <span key={d} title={`day ${d}${leg.prints[d] !== undefined ? `: printed ${leg.prints[d].toFixed(2)}` : d <= today ? " (not a window day yet)" : " (unpriced)"}`} style={{ display: "inline-block", width: 10, height: 10, margin: "0 1px", borderRadius: 2, background: leg.prints[d] !== undefined ? "var(--cash)" : "var(--navy-3)", border: "1px solid var(--line)" }} />)}
      {" "}<Fig v={m.perBbl} fmt="px" what={`${which} value per barrel`} why={`${leg.fixed !== null ? "Fixed: " : "Expected: "}${leg.basis} ${leg.fixed !== null ? "average" : "over the window, printed days fixed and unpriced days at today's forward"} plus the differential ${leg.diff.toFixed(2)}. ${m.unpriced.length} of ${m.n} days unpriced${leg.windowDays ? "" : " (window not anchored yet: expected from day " + leg.expectedAnchorDay + ")"}.`} />
      {leg.amountUsd !== null && <span className="muted"> · {leg.paidTick !== null ? "paid" : "due"} {usd(leg.amountUsd)}</span>}
    </span>
  );
}

function CargoCard({ c, state }: { c: Cargo; state: State }) {
  const submit = useGame((g) => g.submit);
  const select = useGame((g) => g.select);
  const m = cargoMark(state, c);
  const v = state.voyages.find((x) => x.id === c.voyageId);
  const vessel = state.vessels.find((x) => x.id === c.vesselId);
  const phys = physicalExposureBbl(state).byCargo[c.id] ?? 0;
  const held = state.lots.filter((l) => l.inst === "BRENT").reduce((a, l) => a + l.qty, 0) * 1000;
  const coverage = Math.abs(phys) > 1000 ? Math.min(1.5, Math.max(0, -held / phys)) : null;
  const [speed, setSpeed] = useState(v?.speedFactor ?? 1);
  const [anchor, setAnchor] = useState(0);
  const running = state.level.status === "running";
  const quotes = !c.vesselId ? charterQuotes(state, c) : [];
  const opts = v && v.status === "waiting_chokepoint" && v.waitUntil === null ? passageOptions(state, v) : null;
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <div className="flex">
        <strong>{c.id} · {GRADES[c.grade].name} · {c.bbl.toLocaleString()} bbl</strong>
        <span className="badge">{c.status}</span>
        <span className="spacer" />
        <span>mark <Fig v={m.valueUsd} fmt="usd" sign what="Cargo mark" why={`Sale ${c.sale ? "(contracted)" : "(expected at market)"} ${usd(c.sale ? (m.salePerBbl ?? 0) * c.bbl : m.expectedSalePerBbl * c.bbl)} minus purchase ${usd(m.purchasePerBbl * c.bbl)} minus freight ${usd(m.freightUsd)} minus demurrage, war risk and claims ${usd(m.extra.demurrage + m.extra.warRisk + m.extra.quality)}; legs already paid or received are out of the mark and in cash.`} /></span>
      </div>
      <div className="small muted">{c.purchase.incoterm} {PORTS[c.loadPort].name} from {COUNTERPARTIES[c.purchase.counterparty].name} · laycan days {c.laycan[0]}-{c.laycan[1]} · {c.sale ? `${c.sale.incoterm} ${PORTS[c.sale.port].name} to ${COUNTERPARTIES[c.sale.counterparty].name}` : `unsold: marked delivered ${PORTS[c.dischargePort].name} at the market differential`}{c.dischargeWindow ? ` · discharge days ${c.dischargeWindow[0]}-${c.dischargeWindow[1]}` : ""}</div>
      <div style={{ margin: "4px 0" }}><WindowBar state={state} c={c} which="purchase" /></div>
      <div style={{ margin: "4px 0" }}><WindowBar state={state} c={c} which="sale" /></div>
      <div className="small" style={{ margin: "4px 0" }}>
        Exposure <Fig v={phys} fmt="int" what="This cargo's net unpriced barrels" why="Long on the unpriced sale or the unsold oil, short on the unpriced purchase." /> bbl · hedge coverage{" "}
        {coverage === null ? <span className="muted">n/a (no exposure)</span> : <span style={{ display: "inline-block", width: 120, height: 10, background: "var(--navy-3)", borderRadius: 5, verticalAlign: "middle", position: "relative" }}><span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, coverage * 100)}%`, background: coverage > 1.1 || coverage < 0.9 ? "var(--risk)" : "var(--cash)", borderRadius: 5 }} /></span>}
        {coverage !== null && <Fig v={coverage} fmt="pct" decimals={0} what="Hedge coverage" why={`Brent futures held (${held.toLocaleString()} bbl) against this cargo's exposure. Red outside 90% to 110%.`} />}
        {" "}· freight <Fig v={c.freight.fixedUsd ?? c.freight.expectedUsd} fmt="usd" what={c.freight.fixedUsd !== null ? "Freight fixed" : "Freight expected"} why={c.freight.fixedUsd !== null ? `Voyage charter lump sum: ${((c.freight.fixedUsd) / c.bbl).toFixed(2)} $/bbl.${c.freight.paidTick !== null ? " Paid at delivery." : ""}` : "The cheapest fitting quote on the Desk now."} />
        {c.demurrageUsd > 0 && <> · demurrage <Fig v={c.demurrageUsd} fmt="usd" what="Demurrage" why="Hours beyond laytime at the discharge port times the ship's daily hire." /></>}
        {c.warRiskUsd > 0 && <> · war risk and detour <Fig v={c.warRiskUsd} fmt="usd" what="War risk and detour hire" why="Charged when transiting a restricted passage or going round it." /></>}
      </div>
      {vessel && v && <div className="small muted">{vessel.name} ({VESSEL_CLASSES[vessel.cls].name}, {COUNTERPARTIES[vessel.owner].name}) · {v.status.replace("_", " ")} · ETA {formatClock(state.startDay, v.eta)}{v.detour ? ` · ${v.detour}` : ""} · <Link to="/map" onClick={() => select("BRENT", state.listed.BRENT[0])}>show on the map</Link></div>}
      {c.claims.map((k) => <div key={k.id} className="small" style={{ color: "var(--risk)" }}>Claim {k.id} ({k.status}): {k.text} {usd(k.amountUsd)}{k.status === "open" && <> <button onClick={() => submit({ type: "settle_claim", player: "p1", cargoId: c.id, claimId: k.id })}>Settle</button> <button onClick={() => submit({ type: "contest_claim", player: "p1", cargoId: c.id, claimId: k.id })}>Contest</button></>}</div>)}
      {!c.vesselId && running && (
        <div style={{ marginTop: 6 }}>
          <div className="small muted">Charter quotes (voyage, lump sum; stylised hire times days plus margin):</div>
          <table><thead><tr><th>Ship</th><th>Class</th><th>Owner</th><th className="num">Hire/day</th><th className="num">Ballast d</th><th className="num">Laden d</th><th className="num">Lump sum</th><th className="num">$/bbl</th><th className="num">At load port</th><th></th></tr></thead>
            <tbody>{quotes.map((q) => <tr key={q.vesselId} className={q.fits ? "" : "muted"}><td>{q.vessel}</td><td>{q.cls}</td><td className="small">{q.owner}</td><td className="num"><Fig v={q.hireUsdPerDay} fmt="usd" what="Hire per day" why={q.why} stylised /></td><td className="num">{q.ballastDays.toFixed(1)}</td><td className="num">{q.ladenDays.toFixed(1)}</td><td className="num"><Fig v={q.lumpUsd} fmt="usd" what="Lump sum" why={q.why} /></td><td className="num"><Fig v={q.usdPerBbl} fmt="px" what="Freight per barrel" why={`${usd(q.lumpUsd)} / ${c.bbl.toLocaleString()} bbl`} /></td><td className="num">day {q.etaLoadDay}{q.etaLoadDay > c.laycan[1] && <span className="badge bad">misses laycan</span>}</td><td><button className="primary" disabled={!q.fits || q.etaLoadDay > c.laycan[1]} onClick={() => submit({ type: "fix_charter", player: "p1", cargoId: c.id, vesselId: q.vesselId })}>Fix</button></td></tr>)}</tbody></table>
        </div>
      )}
      {v && v.status !== "done" && running && (
        <div className="flex small" style={{ marginTop: 6 }}>
          <label className="muted">speed <input type="range" min={70} max={100} value={Math.round(speed * 100)} onChange={(e) => setSpeed(Number(e.target.value) / 100)} aria-label="speed as a share of service speed" /> {Math.round(speed * 100)}%</label>
          <button onClick={() => submit({ type: "instruct_ship", player: "p1", cargoId: c.id, speedFactor: speed })}>Set speed</button>
          <label className="muted">anchor days <input type="number" min={0} max={60} value={anchor} onChange={(e) => setAnchor(Number(e.target.value))} style={{ width: 60 }} aria-label="days at anchor before notice of readiness" /></label>
          <button onClick={() => submit({ type: "instruct_ship", player: "p1", cargoId: c.id, anchorDays: anchor })}>Hold at anchor</button>
          {opts && <>
            <button className="primary" onClick={() => submit({ type: "instruct_ship", player: "p1", cargoId: c.id, passage: "proceed" })}>Pay war risk and transit (+{opts.proceed.extraDays} d, {usd(opts.proceed.costUsd)})</button>
            {opts.reroute && <button className="primary" onClick={() => submit({ type: "instruct_ship", player: "p1", cargoId: c.id, passage: "reroute" })}>Reroute via {opts.reroute.via} (+{opts.reroute.extraDays.toFixed(1)} d, {usd(opts.reroute.costUsd)})</button>}
          </>}
        </div>
      )}
      {running && state.level.unlockedActions.includes("efp") && (c.purchase.fixed === null && c.blTick !== null || (c.sale && c.sale.fixed === null && c.sale.windowDays)) && (
        <div className="flex small" style={{ marginTop: 6 }}>
          {c.purchase.fixed === null && c.blTick !== null && <button onClick={() => submit({ type: "efp", player: "p1", cargoId: c.id, leg: "purchase" })}>EFP: fix the purchase at today's {c.purchase.basis}</button>}
          {c.sale && c.sale.fixed === null && c.sale.windowDays && <button onClick={() => submit({ type: "efp", player: "p1", cargoId: c.id, leg: "sale" })}>EFP: fix the sale at today's {c.sale.basis}</button>}
        </div>
      )}
    </div>
  );
}

export const voyageLabel = (v: Voyage) => v.status.replace("_", " ");
