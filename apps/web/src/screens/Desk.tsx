import { useState } from "react";
import { Link } from "react-router-dom";
import { cargoMark, charterQuotes, COUNTERPARTIES, formatClock, GRADES, legMark, passageOptions, PORTS, physicalExposureBbl, windowText, VESSEL_CLASSES, counterpartyExposure, STORAGE_TANKS, tankInventory, parcelDiff, isPipeline, type Cargo, type State, type Tender, type Voyage } from "@desk/engine";
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
      <div className="panel" id="tanks">
        <h2>Tanks</h2>
        {state.level.unlockedActions.includes("lease_tank") ? <Tanks state={state} /> : <div className="notyet">not yet: tank leases, fills and draws unlock at level 13. Floating storage: hold a ship at anchor from its cargo card.</div>}
        <h2 style={{ marginTop: 12 }}>Refinery and LNG</h2>
        <div className="notyet">not yet: level 14 and level 15 (milestone 4).</div>
      </div>
      <div className="panel" id="counterparties" style={{ gridColumn: "1 / -1" }}>
        <h2>Counterparties <span className="muted">(ratings, memory, exposure)</span></h2>
        <Counterparties state={state} />
      </div>
    </div>
  );
}

function TenderRow({ t, state }: { t: Tender; state: State }) {
  const submit = useGame((g) => g.submit);
  const [cargoId, setCargoId] = useState<string>(state.cargoes.find((c) => !c.sale && c.grade === t.grade)?.id ?? "");
  const [counter, setCounter] = useState<string>(String(Math.round((t.diff + (t.side === "offer" ? -0.1 : 0.1)) * 100) / 100));
  const [reason, setReason] = useState("");
  const cp = COUNTERPARTIES[t.counterparty];
  const cs = state.counterparties[t.counterparty];
  const hoursLeft = t.expiresTick - state.tick;
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
      <div className="flex">
        <strong>{t.side === "offer" ? "Offer" : "Bid"} {t.id}</strong>
        <span>{cp.name}<span className={`badge ${cs && (cs.defaulted || cs.gone) ? "bad" : ""}`}>{cs?.rating ?? cp.rating}</span></span>
        {t.requiresLc && <span className="badge warn">LC required</span>}
        <span className="badge warn">closes in {hoursLeft}h</span>
      </div>
      <div className="small" style={{ margin: "4px 0" }}>{t.note}</div>
      <div className="small muted">
        {GRADES[t.grade].name} · {t.bbl.toLocaleString()} bbl · {t.incoterm} {PORTS[t.port].name} · {t.basis} <Fig v={t.diff} fmt="signed" what="Contract differential" why={`Over ${t.basis}. The market's fair differential on these terms is ${t.fairDiff >= 0 ? "+" : ""}${t.fairDiff.toFixed(2)} (grade grid${t.incoterm !== "FOB" ? " plus freight and insurance" : ""}); ${cp.name}'s profile: ${cp.profile}.`} /> · {windowText(t.window)} · {t.side === "offer" ? "laycan" : "discharge"} days {t.laycan[0]}-{t.laycan[1]}
      </div>
      <div className="flex" style={{ marginTop: 6 }}>
        {t.side === "bid" && <select aria-label="cargo to sell" value={cargoId} onChange={(e) => setCargoId(e.target.value)}><option value="">pick a cargo</option>{state.cargoes.filter((c) => !c.sale && c.status !== "cancelled").map((c) => <option key={c.id} value={c.id}>{c.id} {GRADES[c.grade].name} {c.bbl.toLocaleString()} bbl{c.tankId ? ` (in ${c.tankId})` : ""}</option>)}</select>}
        <button className="primary" onClick={() => submit({ type: "accept_tender", player: "p1", tenderId: t.id, cargoId: t.side === "bid" ? cargoId : undefined })} disabled={state.level.status !== "running" || (t.side === "bid" && !cargoId)}>Accept</button>
        {t.side === "offer" && t.prepayDiscount > 0 && <button className="primary" onClick={() => submit({ type: "accept_tender", player: "p1", tenderId: t.id, prepay: true })} disabled={state.level.status !== "running"}>Accept and prepay ({t.prepayDiscount.toFixed(2)} off)</button>}
        {state.level.unlockedActions.includes("counter_tender") && !t.countered && <><input aria-label="counter differential" type="number" step={0.05} value={counter} onChange={(e) => setCounter(e.target.value)} style={{ width: 90 }} /><button onClick={() => submit({ type: "counter_tender", player: "p1", tenderId: t.id, diff: parseFloat(counter) })} disabled={!Number.isFinite(parseFloat(counter))}>Counter</button></>}
        {t.countered && <span className={`badge ${t.countered.answer === "accepted" ? "ok" : "bad"}`}>counter {t.countered.diff >= 0 ? "+" : ""}{t.countered.diff.toFixed(2)} {t.countered.answer}</span>}
        <input aria-label="reason for declining" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="reason (optional)" style={{ width: 200 }} />
        <button onClick={() => submit({ type: "decline_tender", player: "p1", tenderId: t.id, reason: reason || undefined })}>Decline</button>
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
  const tankOf = state.tanks.find((k) => k.id === c.tankId);
  const hedgeInst = tankOf ? (tankOf.port === "CUSHING" || tankOf.port === "HOUSTON" || tankOf.port === "ST_JAMES" ? "WTI" : "BRENT") : "BRENT";
  const held = state.lots.filter((l) => l.inst === hedgeInst).reduce((a, l) => a + l.qty, 0) * 1000;
  const coverage = Math.abs(phys) > 1000 ? Math.min(1.5, Math.max(0, -held / phys)) : null;
  const [speed, setSpeed] = useState(v?.speedFactor ?? 1);
  const [anchor, setAnchor] = useState(0);
  const running = state.level.status === "running";
  const quotes = !c.vesselId && !isPipeline(c) ? charterQuotes(state, c) : [];
  const opts = v && v.status === "waiting_chokepoint" && v.waitUntil === null ? passageOptions(state, v) : null;
  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <div className="flex">
        <strong>{c.id} · {GRADES[c.grade].name} · {c.bbl.toLocaleString()} bbl</strong>
        <span className="badge">{c.status}</span>
        <span className="spacer" />
        <span>mark <Fig v={m.valueUsd} fmt="usd" sign what="Cargo mark" why={`Sale ${c.sale ? "(contracted)" : "(expected at market)"} ${usd(c.sale ? (m.salePerBbl ?? 0) * c.bbl : m.expectedSalePerBbl * c.bbl)} minus purchase ${usd(m.purchasePerBbl * c.bbl)} minus freight ${usd(m.freightUsd)} minus demurrage, war risk and claims ${usd(m.extra.demurrage + m.extra.warRisk + m.extra.quality)}; legs already paid or received are out of the mark and in cash.`} /></span>
      </div>
      <div className="small muted">{c.purchase.incoterm} {PORTS[c.loadPort].name} from {COUNTERPARTIES[c.purchase.counterparty].name} · {isPipeline(c) ? `transfer days ${c.laycan[0]}-${c.laycan[1]}` : `laycan days ${c.laycan[0]}-${c.laycan[1]}`} · {c.sale ? `${c.sale.incoterm} ${PORTS[c.sale.port].name} to ${COUNTERPARTIES[c.sale.counterparty].name}` : c.tankId ? `in tank ${c.tankId} at ${PORTS[tankOf?.port ?? c.loadPort].name}: the oil is marked in the tank; this card carries the purchase until it is paid` : `unsold: marked delivered ${PORTS[c.dischargePort].name} at the market differential`}{c.dischargeWindow ? ` · discharge days ${c.dischargeWindow[0]}-${c.dischargeWindow[1]}` : ""}</div>
      <div style={{ margin: "4px 0" }}><WindowBar state={state} c={c} which="purchase" /></div>
      <div style={{ margin: "4px 0" }}><WindowBar state={state} c={c} which="sale" /></div>
      <div className="small" style={{ margin: "4px 0" }}>
        Exposure <Fig v={phys} fmt="int" what="This cargo's net unpriced barrels" why="Long on the unpriced sale or the unsold oil, short on the unpriced purchase." /> bbl · hedge coverage{" "}
        {coverage === null ? <span className="muted">n/a (no exposure)</span> : <span style={{ display: "inline-block", width: 120, height: 10, background: "var(--navy-3)", borderRadius: 5, verticalAlign: "middle", position: "relative" }}><span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, coverage * 100)}%`, background: coverage > 1.1 || coverage < 0.9 ? "var(--risk)" : "var(--cash)", borderRadius: 5 }} /></span>}
        {coverage !== null && <Fig v={coverage} fmt="pct" decimals={0} what="Hedge coverage" why={`${hedgeInst} futures held (${held.toLocaleString()} bbl) against this cargo's exposure. Red outside 90% to 110%.`} />}
        {" "}· freight <Fig v={c.freight.fixedUsd ?? c.freight.expectedUsd} fmt="usd" what={c.freight.fixedUsd !== null ? "Freight fixed" : "Freight expected"} why={c.freight.fixedUsd !== null ? `Voyage charter lump sum: ${((c.freight.fixedUsd) / c.bbl).toFixed(2)} $/bbl.${c.freight.paidTick !== null ? " Paid at delivery." : ""}` : "The cheapest fitting quote on the Desk now."} />
        {c.demurrageUsd > 0 && <> · demurrage <Fig v={c.demurrageUsd} fmt="usd" what="Demurrage" why="Hours beyond laytime at the discharge port times the ship's daily hire." /></>}
        {c.warRiskUsd > 0 && <> · war risk and detour <Fig v={c.warRiskUsd} fmt="usd" what="War risk and detour hire" why="Charged when transiting a restricted passage or going round it." /></>}
      </div>
      {vessel && v && <div className="small muted">{vessel.name} ({VESSEL_CLASSES[vessel.cls].name}, {COUNTERPARTIES[vessel.owner].name}) · {v.status.replace("_", " ")} · ETA {formatClock(state.startDay, v.eta)}{v.detour ? ` · ${v.detour}` : ""} · <Link to="/map" onClick={() => select("BRENT", state.listed.BRENT[0])}>show on the map</Link></div>}
      {running && c.status !== "cancelled" && (
        <div className="flex small" style={{ marginTop: 6 }}>
          {state.level.unlockedActions.includes("open_lc") && !c.lcId && (c.status === "contracted" || c.status === "fixed") && <button className={c.requiresLc ? "primary" : ""} onClick={() => submit({ type: "open_lc", player: "p1", cargoId: c.id })}>{c.requiresLc ? "Open the letter of credit (required)" : "Open a letter of credit"}</button>}
          {c.lcId && <span className="badge ok">{c.lcId}</span>}
          {state.level.unlockedActions.includes("insure") && !c.insured && c.status !== "delivered" && <button onClick={() => submit({ type: "insure", player: "p1", cargoId: c.id })}>Insure against non-performance</button>}
          {c.insured && <span className="badge ok">insured</span>}
          {c.prepaidUsd > 0 && <span className="badge">prepaid {usd(c.prepaidUsd)}</span>}
          {state.level.unlockedActions.includes("store_cargo") && c.status === "delivered" && !c.tankId && !c.sale && state.tanks.filter((t) => !t.released && t.port === (isPipeline(c) ? c.loadPort : c.dischargePort)).map((t) => <button key={t.id} onClick={() => submit({ type: "store_cargo", player: "p1", cargoId: c.id, tankId: t.id })}>Store in {t.id} at {PORTS[t.port].name}</button>)}
          {c.tankId && <span className="badge">in tank {c.tankId}</span>}
        </div>
      )}
      {c.cancelled && <div className="small" style={{ color: "var(--risk)" }}>Cancelled: {c.cancelled.reason}.</div>}
      {c.claims.map((k) => <div key={k.id} className="small" style={{ color: "var(--risk)" }}>Claim {k.id} ({k.status}): {k.text} {usd(k.amountUsd)}{k.status === "open" && <> <button onClick={() => submit({ type: "settle_claim", player: "p1", cargoId: c.id, claimId: k.id })}>Settle</button> <button onClick={() => submit({ type: "contest_claim", player: "p1", cargoId: c.id, claimId: k.id })}>Contest</button></>}</div>)}
      {!c.vesselId && running && !isPipeline(c) && c.status !== "cancelled" && (
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

function Tanks({ state }: { state: State }) {
  const submit = useGame((g) => g.submit);
  const [port, setPort] = useState("CUSHING");
  const [bbl, setBbl] = useState(500000);
  const [months, setMonths] = useState(2);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const running = state.level.status === "running";
  return (
    <div>
      {state.tanks.filter((t) => !t.released).length === 0 ? <div className="muted small">No tank leased.</div> : state.tanks.filter((t) => !t.released).map((t) => (
        <div key={t.id} className="small" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
          <strong>{t.id} at {PORTS[t.port].name}</strong> · <Fig v={tankInventory(t)} fmt="int" what="Barrels in the tank" why="The sum of its parcels." /> of {t.capacityBbl.toLocaleString()} bbl · <Fig v={t.costPerBblMonth} fmt="px" what="Lease cost per barrel per month" why={`${t.currency}, charged monthly on the whole capacity; ${t.chargesPaid} of ${t.months} months of the minimum term paid.`} stylised /> {t.currency}/bbl/month · next charge {formatClock(state.startDay, t.nextChargeTick).slice(4)}
          {t.parcels.map((p) => <div key={p.id} style={{ marginLeft: 10 }}><label><input type="checkbox" checked={!!chosen[p.id]} onChange={(e) => setChosen({ ...chosen, [p.id]: e.target.checked })} aria-label={`select parcel ${p.id}`} /> {p.id} {p.label}: {p.bbl.toLocaleString()} bbl, {p.api.toFixed(1)} API, {p.sulphur.toFixed(2)}% S, marked at {p.benchmark} <Fig v={parcelDiff(state, p)} fmt="signed" what="Differential over the benchmark" why={p.grade === "BLEND" ? "On the quality grid: 0.12 $/bbl per API degree around 38 and 2.00 $/bbl per sulphur point around 0.5%, less a blend discount (stylised)." : "The grade's market differential."} /></label></div>)}
          {running && <div className="flex" style={{ marginTop: 4 }}>
            <button onClick={() => submit({ type: "blend", player: "p1", tankId: t.id, parcelIds: t.parcels.filter((p) => chosen[p.id]).map((p) => p.id) })} disabled={t.parcels.filter((p) => chosen[p.id]).length < 2}>Blend the selected parcels</button>
            <button onClick={() => submit({ type: "release_tank", player: "p1", tankId: t.id })}>Release the tank</button>
          </div>}
        </div>
      ))}
      {running && <div className="flex small" style={{ marginTop: 8 }}>
        <select aria-label="port to lease at" value={port} onChange={(e) => setPort(e.target.value)}>{Object.values(STORAGE_TANKS).map((t) => <option key={t.port} value={t.port}>{PORTS[t.port].name}: {t.costPerBblMonth.value.toFixed(2)} {t.currency}/bbl/month, min {t.minMonths.value} mo</option>)}</select>
        <input aria-label="barrels to lease" type="number" step={50000} value={bbl} onChange={(e) => setBbl(Number(e.target.value))} style={{ width: 110 }} />
        <input aria-label="months" type="number" min={1} max={12} value={months} onChange={(e) => setMonths(Number(e.target.value))} style={{ width: 60 }} />
        <button className="primary" onClick={() => submit({ type: "lease_tank", player: "p1", port, bbl, months })}>Lease</button>
      </div>}
    </div>
  );
}

function Counterparties({ state }: { state: State }) {
  const cx = counterpartyExposure(state);
  const rows = Object.values(state.counterparties).filter((c) => COUNTERPARTIES[c.id].type !== "bank");
  return (
    <table><thead><tr><th>Name</th><th>Type</th><th>Rating</th><th>Profile and memory</th><th className="num">Exposure</th><th className="num">x capital</th></tr></thead>
      <tbody>{rows.map((c) => { const cp = COUNTERPARTIES[c.id]; const e = cx.byId[c.id] ?? 0; return <tr key={c.id} className={c.defaulted || c.gone ? "muted" : ""}><td>{cp.name}{c.defaulted ? <span className="badge bad">defaulted</span> : c.gone ? <span className="badge bad">gone</span> : null}</td><td className="small">{cp.type}</td><td><Fig v={c.ratingScore} fmt="int" what={`Rating ${c.rating}`} why={`Score ${c.ratingScore.toFixed(0)} of 100: ${c.rating}. Ratings move with events; late payments and defaults cut them.`} /> <span className={`badge ${c.ratingScore < 50 ? "bad" : c.ratingScore < 70 ? "warn" : "ok"}`}>{c.rating}</span></td><td className="small muted">{c.note}{c.late ? ` · paid late ${c.late}x` : ""}</td><td className="num"><Fig v={e} fmt="usd" what="Exposure to this name" why="Undelivered cargoes bought from them (and prepayments), plus unpaid sales to them." /></td><td className="num">{e > 0 ? <Fig v={e / state.capital} fmt="px" decimals={1} what="Exposure as a multiple of capital" why={`Against a concentration limit of ${state.risk.limits.concentration < 50 ? state.risk.limits.concentration.toFixed(1) + "x capital" : "none in this level"}.`} /> : <span className="muted">-</span>}</td></tr>; })}</tbody></table>
  );
}
