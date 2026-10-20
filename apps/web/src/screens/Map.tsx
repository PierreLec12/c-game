/**
 * The canvas world: land drawn once to an offscreen canvas in an equal-earth projection, ships as moving markers
 * with fading trails, ports, chokepoints with status, routes highlighted when a cargo is selected, callouts.
 * Nothing is fetched: the coastline is bundled.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { geoEqualEarth, geoPath } from "d3-geo";
import { CHOKEPOINTS, CHOKEPOINT_SPECS, COUNTERPARTIES, GRADES, NODE_BY_ID, PORTS, VESSEL_CLASSES, formatClock, legMark, passageOptions, physicalExposureBbl, positionAlong, shortestPath, windowText, type State, type Voyage } from "@desk/engine";
import land from "../map/land.json";
import { useGame } from "../store";
import { Fig } from "../components/Fig";

const W = 1100, H = 560;
const usd = (x: number) => (x < 0 ? "-$" : "$") + Math.abs(Math.round(x)).toLocaleString();

export function Map() {
  const state = useGame((g) => g.state);
  const [hover, setHover] = useState<{ x: number; y: number; kind: "ship" | "port" | "chokepoint" | "route"; id: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landRef = useRef<HTMLCanvasElement | null>(null);
  const projection = useMemo(() => geoEqualEarth().fitSize([W, H], land as never), []);
  const path = useMemo(() => geoPath(projection), [projection]);
  // the land, drawn once
  useEffect(() => {
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const ctx = off.getContext("2d")!;
    ctx.fillStyle = "#0b1220"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#1b2740"; ctx.strokeStyle = "#2b3a5a"; ctx.lineWidth = 0.6;
    const p = geoPath(projection, ctx);
    ctx.beginPath(); p(land as never); ctx.fill(); ctx.stroke();
    landRef.current = off;
  }, [projection]);
  const tickShown = scrub ?? state?.tick ?? 0;
  // ship positions at the shown tick (live, or replayed along the schedule for the scrubber)
  const ships = useMemo(() => {
    if (!state) return [];
    return state.voyages.filter((v) => v.status !== "done" || scrub !== null).map((v) => ({ v, pos: positionAt(state, v, tickShown), trail: trailAt(state, v, tickShown) }));
  }, [state, tickShown, scrub]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state || !landRef.current) return;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(landRef.current, 0, 0);
    const pt = (lon: number, lat: number) => projection([lon, lat]) as [number, number];
    // routes of the selected or hovered cargo
    for (const { v } of ships) {
      const sel = selected === v.cargoId || hover?.id === v.id;
      const leg = v.legs[v.legIndex] ?? v.legs[v.legs.length - 1];
      ctx.strokeStyle = sel ? "rgba(242,181,63,0.9)" : "rgba(242,181,63,0.25)";
      ctx.lineWidth = sel ? 1.8 : 0.8;
      ctx.setLineDash(leg.kind === "ballast" ? [3, 4] : []);
      ctx.beginPath();
      leg.path.forEach((n, i) => { const node = NODE_BY_ID[n]; const [x, y] = pt(node.lon, node.lat); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // ports
    for (const port of Object.values(PORTS)) {
      if (!port.node) continue;
      const [x, y] = pt(port.lon, port.lat);
      ctx.fillStyle = port.lng ? "#6be3ff" : "#a9b8cf";
      ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
      if (!port.lng && port.id !== "CORPUS_CHRISTI") { ctx.fillStyle = "#8e9db7"; ctx.font = "9px sans-serif"; ctx.fillText(port.name, x + 4, y - 3); }
    }
    // chokepoints
    for (const cp of CHOKEPOINTS) {
      const st = state.chokepoints[cp.id];
      const [x, y] = pt(cp.lon, cp.lat);
      ctx.strokeStyle = st?.status === "closed" ? "#ff6b6b" : st?.status === "restricted" ? "#f2b53f" : "#5aa9ff";
      ctx.lineWidth = st && st.status !== "open" ? 2.2 : 1;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke();
      if (st && st.status !== "open" && (state.tick - st.since) < 12) { ctx.strokeStyle = "rgba(255,107,107,0.5)"; ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke(); }
    }
    // idle vessels
    for (const vs of state.vessels) {
      if (vs.voyageId) continue;
      const [x, y] = pt(vs.lon, vs.lat);
      ctx.fillStyle = "rgba(169,184,207,0.7)";
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    // ships with trails
    for (const { v, pos, trail } of ships) {
      for (let i = 1; i < trail.length; i++) {
        const [x0, y0] = pt(trail[i - 1][1], trail[i - 1][2]);
        const [x1, y1] = pt(trail[i][1], trail[i][2]);
        ctx.strokeStyle = `rgba(63,211,197,${(i / trail.length) * 0.8})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      const [x, y] = pt(pos.lon, pos.lat);
      ctx.fillStyle = v.status === "waiting_chokepoint" ? "#ff6b6b" : v.status === "anchored" || v.status === "waiting_berth" ? "#e0c58b" : "#3fd3c5";
      ctx.beginPath(); ctx.arc(x, y, selected === v.cargoId ? 6 : 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#0b1220"; ctx.lineWidth = 1; ctx.stroke();
    }
  }, [state, ships, selected, hover, projection, path]);

  if (!state) return <div className="panel"><h1>Map</h1><p className="notyet">not yet: start a level from the Academy.</p></div>;
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W, y = ((e.clientY - rect.top) / rect.height) * H;
    const pt = (lon: number, lat: number) => projection([lon, lat]) as [number, number];
    const acc: { best: { d: number; kind: "ship" | "port" | "chokepoint"; id: string } | null } = { best: null };
    const consider = (kind: "ship" | "port" | "chokepoint", id: string, lon: number, lat: number, r: number) => { const [px, py] = pt(lon, lat); const d = Math.hypot(px - x, py - y); if (d < r && (!acc.best || d < acc.best.d)) acc.best = { d, kind, id }; };
    for (const { v, pos } of ships) consider("ship", v.id, pos.lon, pos.lat, 10);
    for (const cp of CHOKEPOINTS) consider("chokepoint", cp.id, cp.lon, cp.lat, 9);
    for (const p of Object.values(PORTS)) if (p.node) consider("port", p.id, p.lon, p.lat, 7);
    const best = acc.best;
    setHover(best ? { x: e.clientX - rect.left, y: e.clientY - rect.top, kind: best.kind, id: best.id } : null);
  };
  const onClick = () => { if (hover?.kind === "ship") { const v = state.voyages.find((x) => x.id === hover.id); setSelected(v ? (selected === v.cargoId ? null : v.cargoId) : null); } };
  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr" }}>
      <div className="panel" style={{ position: "relative", padding: 8 }} id="map">
        <canvas ref={canvasRef} width={W} height={H} style={{ width: "100%", height: "auto", display: "block", borderRadius: 6, cursor: hover ? "pointer" : "default" }} onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={onClick} role="img" aria-label={`World map: ${ships.length} ship${ships.length === 1 ? "" : "s"} under way, ${Object.values(state.chokepoints).filter((c) => c.status !== "open").length} chokepoint restrictions`} />
        {hover && <Callout state={state} hover={hover} ships={ships} />}
        <div className="flex small" style={{ marginTop: 6 }}>
          <span className="muted">Time scrubber</span>
          <input type="range" min={0} max={state.tick} value={tickShown} onChange={(e) => setScrub(Number(e.target.value) === state.tick ? null : Number(e.target.value))} style={{ flex: 1 }} aria-label="scrub the level's timeline" />
          <span className="mono">{formatClock(state.startDay, tickShown)}{scrub !== null && <button className="ghost" onClick={() => setScrub(null)}>live</button>}</span>
          <span className="muted">· click a ship to pin its route · teal ship: under way, sand: waiting, red: held at a passage</span>
        </div>
        <div className="small muted" id="chokepoints">
          {CHOKEPOINTS.map((cp) => { const st = state.chokepoints[cp.id]; return <span key={cp.id} style={{ marginRight: 10 }}><span className={`badge ${st?.status === "closed" ? "bad" : st?.status === "restricted" ? "warn" : ""}`}>{cp.name}: {st?.status ?? "open"}</span></span>; })}
        </div>
      </div>
      <div className="panel" id="route">
        <h2>Under way</h2>
        {state.voyages.filter((v) => v.status !== "done").length === 0 ? <div className="muted">No ship under way.</div> : state.voyages.filter((v) => v.status !== "done").map((v) => <VoyageRow key={v.id} state={state} v={v} />)}
      </div>
    </div>
  );
}

function positionAt(state: State, v: Voyage, tick: number): { lon: number; lat: number } {
  if (tick >= state.tick) return positionAlong(v.legs[v.legIndex]?.path ?? v.legs[v.legs.length - 1].path, v.nmDone);
  // scrubbing back: the trail is the honest record of the last two days; before that, the leg schedule
  const t = v.trail.find((x) => x[0] >= tick);
  if (t) return { lon: t[1], lat: t[2] };
  const leg = v.legs.find((l) => l.depTick !== null && l.depTick <= tick && (l.arrTick === null || l.arrTick >= tick));
  if (!leg) { const n0 = NODE_BY_ID[v.legs[0].from]; return { lon: n0.lon, lat: n0.lat }; }
  const vessel = state.vessels.find((x) => x.id === v.vesselId)!;
  const kn = (leg.kind === "laden" ? VESSEL_CLASSES[vessel.cls].speedLaden : VESSEL_CLASSES[vessel.cls].speedBallast) * vessel.speedFactor * v.speedFactor;
  return positionAlong(leg.path, (tick - leg.depTick!) * kn);
}
function trailAt(state: State, v: Voyage, tick: number): [number, number, number][] {
  return v.trail.filter((t) => t[0] <= tick).slice(-48);
}

function Callout({ state, hover, ships }: { state: State; hover: { x: number; y: number; kind: string; id: string }; ships: { v: Voyage; pos: { lon: number; lat: number } }[] }) {
  const style: React.CSSProperties = { position: "absolute", left: Math.min(hover.x + 12, 700), top: hover.y + 12, background: "#1c2742", border: "1px solid var(--muted)", borderRadius: 6, padding: "8px 10px", width: 340, fontSize: 12, zIndex: 20, pointerEvents: "none" };
  if (hover.kind === "port") {
    const p = PORTS[hover.id];
    return <div style={style}><strong>{p.name}</strong><div className="muted">takes up to {VESSEL_CLASSES[p.maxClass].name}{p.loads.length ? ` · loads ${p.loads.map((g) => GRADES[g].name).join(", ")}` : ""}{p.discharge ? " · discharge" : ""}{p.storage ? " · storage" : ""}{p.lng ? ` · LNG ${p.lng}` : ""}</div>{state.portCongestion[p.id] && state.portCongestion[p.id] > state.tick ? <div style={{ color: "var(--crude)" }}>congested until {formatClock(state.startDay, state.portCongestion[p.id])}</div> : null}</div>;
  }
  if (hover.kind === "chokepoint") {
    const cp = CHOKEPOINT_SPECS[hover.id];
    const st = state.chokepoints[hover.id];
    const ref = CHOKEPOINTS.find((c) => c.id === hover.id)!;
    return <div style={style}><strong>{cp.name}</strong> <span className={`badge ${st.status === "closed" ? "bad" : st.status === "restricted" ? "warn" : "ok"}`}>{st.status}</span><div className="muted">{cp.what} (stylised: {ref.shareOfSeaborneOil.basis}). When it shuts: freight index +{Math.round(cp.freightShock.value * 100)}%, Brent-Dubai +{cp.ewShock.value.toFixed(1)} $/bbl; a restricted transit waits {cp.restrictedDelayDays.value} days and pays {cp.warRiskUsdPerBbl.value.toFixed(2)} $/bbl of war risk.</div></div>;
  }
  const entry = ships.find((s) => s.v.id === hover.id);
  if (!entry) return null;
  const v = entry.v;
  const cargo = state.cargoes.find((c) => c.id === v.cargoId)!;
  const vessel = state.vessels.find((x) => x.id === v.vesselId)!;
  const leg = v.legs[v.legIndex] ?? v.legs[v.legs.length - 1];
  const phys = physicalExposureBbl(state).byCargo[cargo.id] ?? 0;
  const held = state.lots.filter((l) => l.inst === "BRENT").reduce((a, l) => a + l.qty, 0);
  const unhedged = phys + held * 1000;
  const p = legMark(state, cargo, cargo.purchase);
  const opts = v.status === "waiting_chokepoint" ? passageOptions(state, v) : null;
  return (
    <div style={style}>
      <strong>{vessel.name}</strong> <span className="muted">{VESSEL_CLASSES[vessel.cls].name}, {COUNTERPARTIES[vessel.owner].name}</span>
      <div>{GRADES[cargo.grade].name} {cargo.bbl.toLocaleString()} bbl · {leg.kind} leg {PORTS[cargo.loadPort].name} to {PORTS[cargo.dischargePort].name} · {v.status.replace("_", " ")}</div>
      <div className="muted">{Math.round(leg.nm).toLocaleString()} nm, {(leg.nm / (VESSEL_CLASSES[vessel.cls].speedLaden * 24)).toFixed(1)} days at service speed, {Math.round(v.speedFactor * 100)}% now · ETA {formatClock(state.startDay, v.eta)}{v.detour ? ` · ${v.detour}` : ""}</div>
      <div className="muted">freight {usd(v.lumpUsd)} = {(v.lumpUsd / cargo.bbl).toFixed(2)} $/bbl, {((v.lumpUsd / cargo.bbl) / state.factors.brentPrompt * 100).toFixed(1)}% of the barrel</div>
      <div>window: purchase {windowText(cargo.purchase.window)} {p.unpriced.length}/{p.n} unpriced{cargo.sale ? `; sale ${windowText(cargo.sale.window)} ${legMark(state, cargo, cargo.sale).unpriced.length}/${legMark(state, cargo, cargo.sale).n} unpriced` : "; unsold"}</div>
      <div>hedge: {held} Brent lots · <span style={{ color: Math.abs(unhedged) > cargo.bbl * 0.1 ? "var(--risk)" : "var(--cash)" }}>unhedged {Math.round(unhedged).toLocaleString()} bbl</span></div>
      {opts && <div style={{ color: "var(--crude)" }}>transit: +{opts.proceed.extraDays} d, {usd(opts.proceed.costUsd)} · {opts.reroute ? `round ${opts.reroute.via}: +${opts.reroute.extraDays.toFixed(1)} d, ${usd(opts.reroute.costUsd)}` : "no alternative"}</div>}
    </div>
  );
}

function VoyageRow({ state, v }: { state: State; v: Voyage }) {
  const cargo = state.cargoes.find((c) => c.id === v.cargoId)!;
  const vessel = state.vessels.find((x) => x.id === v.vesselId)!;
  const leg = v.legs[v.legIndex];
  const alt = leg && leg.kind === "laden" ? shortestPath(leg.from, leg.to, new Set([...leg.path.filter((n) => NODE_BY_ID[n].chokepoint && NODE_BY_ID[n].chokepoint !== "CAPE")])) : null;
  return (
    <div className="small" style={{ padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
      <strong>{vessel.name}</strong> · {GRADES[cargo.grade].name} {cargo.id} · {v.status.replace("_", " ")} · {leg ? <>{Math.round(leg.nm).toLocaleString()} nm {leg.kind}, <Fig v={v.nmDone / Math.max(1, leg.nm)} fmt="pct" decimals={0} what="Leg progress" why={`${Math.round(v.nmDone).toLocaleString()} of ${Math.round(leg.nm).toLocaleString()} nautical miles.`} /></> : "arrived"} · ETA {formatClock(state.startDay, v.eta)}
      {alt && alt.path.length !== leg.path.length && <span className="muted"> · alternative avoiding the straits: {Math.round(alt.nm).toLocaleString()} nm</span>}
    </div>
  );
}
