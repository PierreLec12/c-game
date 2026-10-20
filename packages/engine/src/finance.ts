/**
 * Cash, the credit line, margin and financing (section 7). Every movement of cash is a ledger row,
 * so cash is always the sum of its ledger (tested as an invariant).
 */
import { FINANCE, INSTRUMENTS, INTER_COMMODITY_OFFSET, MAINTENANCE_MARGIN_SHARE, SPREAD_MARGIN_OFFSET, type InstrumentId } from "./refdata";
import { CREDIT, GRADES } from "./world_data";
import type { Cargo, EngineEvent, LetterOfCredit } from "./types";
import type { FinanceState, LedgerKind, State } from "./types";
import { ckey, nextId } from "./liquidity";

export function initFinance(capital: number, lineLimit: number): FinanceState {
  return {
    cashUSD: 0, cashEUR: 0, marginAccount: 0, marginRequired: 0, marginCall: null, marginCalls: 0,
    lineDrawn: 0, lineLimit, lineCut: false, autoDrawn: 0, eurFxMark: 0, ledger: [], interestAccrued: 0,
  };
}

export function ledger(state: State, kind: LedgerKind, amount: number, text: string, currency: "USD" | "EUR" = "USD"): void {
  if (Math.abs(amount) < 1e-9) return;
  const row = { id: nextId(state, "ledger", "l"), tick: state.tick, kind, amount, currency, text };
  state.finance.ledger.push(row);
  if (currency === "USD") state.finance.cashUSD += amount;
  else state.finance.cashEUR += amount;
}

/** USD value of one price unit times one lot, for a lot of `inst`. */
export function lotValueUsd(state: State, inst: InstrumentId): number {
  const spec = INSTRUMENTS[inst];
  return spec.lot * (spec.currency === "EUR" ? state.factors.eurusd : 1);
}

export interface MarginBreakdown { total: number; byInstrument: Record<string, { gross: number; net: number; rate: number; price: number; im: number }>; offsets: number; why: string }

/** Initial margin for the open book: a share of notional per instrument with spread offsets. */
export function marginRequired(state: State): MarginBreakdown {
  const by: MarginBreakdown["byInstrument"] = {};
  const net: Partial<Record<InstrumentId, number>> = {};
  let total = 0;
  for (const lot of state.lots) {
    const spec = INSTRUMENTS[lot.inst];
    const q = state.quotes[ckey(lot.inst, lot.month)];
    const price = q ? q.mid : lot.lastMark;
    const row = by[lot.inst] ?? (by[lot.inst] = { gross: 0, net: 0, rate: spec.initialMarginShare.value, price, im: 0 });
    row.gross += Math.abs(lot.qty);
    row.net += lot.qty;
    row.price = price;
  }
  for (const [inst, row] of Object.entries(by)) {
    const spec = INSTRUMENTS[inst as InstrumentId];
    const unit = row.price * lotValueUsd(state, inst as InstrumentId);
    const netAbs = Math.abs(row.net);
    const spreadLots = row.gross - netAbs; // lots paired across months
    row.im = row.rate * unit * (netAbs + spreadLots * (1 - SPREAD_MARGIN_OFFSET.value));
    net[inst as InstrumentId] = row.net * unit * spec.initialMarginShare.value; // margin-weighted net for inter-commodity offsets
    total += row.im;
  }
  // inter-commodity offsets: opposite net positions in Brent and WTI, and crude versus products, pair off at 60%
  let offsets = 0;
  const pairs: [InstrumentId, InstrumentId][] = [["BRENT", "WTI"], ["BRENT", "DUBAI"], ["WTI", "RBOB"], ["WTI", "ULSD"], ["BRENT", "RBOB"], ["BRENT", "ULSD"]];
  const remaining = { ...net };
  for (const [a, b] of pairs) {
    const x = remaining[a] ?? 0;
    const y = remaining[b] ?? 0;
    if (x * y < 0) {
      const paired = Math.min(Math.abs(x), Math.abs(y));
      offsets += paired * INTER_COMMODITY_OFFSET.value;
      remaining[a] = x - Math.sign(x) * paired;
      remaining[b] = y - Math.sign(y) * paired;
    }
  }
  total = Math.max(0, total - offsets);
  const why = Object.entries(by).map(([i, r]) => `${i}: ${r.rate * 100}% of ${r.gross} lots at ${r.price.toFixed(INSTRUMENTS[i as InstrumentId].decimals)} = $${Math.round(r.im).toLocaleString()}`).join("; ") + (offsets > 0 ? `; inter-commodity offsets -$${Math.round(offsets).toLocaleString()}` : "");
  return { total, byInstrument: by, offsets, why: why || "no open positions" };
}

/** Move cash to or from the margin account so it holds the required initial margin; draw the line when cash is short. */
export function rebalanceMargin(state: State): string[] {
  const notes: string[] = [];
  const req = marginRequired(state).total;
  state.finance.marginRequired = req;
  const delta = req - state.finance.marginAccount;
  if (delta > 0.005) {
    const short = delta - state.finance.cashUSD;
    if (short > 0 && !state.finance.lineCut) {
      const draw = Math.min(short, lineAvailable(state));
      if (draw > 0) {
        state.finance.lineDrawn += draw;
        state.finance.autoDrawn += draw;
        ledger(state, "line_draw", draw, `Drew $${Math.round(draw).toLocaleString()} on the line to post initial margin`);
        notes.push(`drew $${Math.round(draw).toLocaleString()} on the credit line for margin`);
      }
    }
    const move = Math.min(delta, Math.max(0, state.finance.cashUSD));
    if (move > 0) {
      ledger(state, "initial_margin", -move, `Posted $${Math.round(move).toLocaleString()} initial margin`);
      state.finance.marginAccount += move;
    }
  } else if (delta < -0.005) {
    const release = -delta;
    ledger(state, "margin_release", release, `Margin released: $${Math.round(release).toLocaleString()}`);
    state.finance.marginAccount -= release;
  }
  repayAutoDrawn(state);
  return notes;
}

/** What the engine drew for margin or variation margin is repaid as soon as cash allows; the player's own draws stay. */
export function repayAutoDrawn(state: State): void {
  const f = state.finance;
  if (f.autoDrawn > 0 && f.cashUSD > 0) {
    const repay = Math.min(f.autoDrawn, f.lineDrawn, f.cashUSD);
    if (repay > 0.005) {
      f.lineDrawn -= repay;
      f.autoDrawn -= repay;
      ledger(state, "line_repay", -repay, `Repaid $${Math.round(repay).toLocaleString()} of the line the desk drew for margin`);
    }
  }
}

/** After a settle: cover negative cash from the line; raise a margin call when the line cannot. */
export function checkMarginCall(state: State, nextCloseTick: number): { raised: boolean; met: boolean; amount: number } {
  const f = state.finance;
  if (f.cashUSD < -0.005) {
    const need = -f.cashUSD;
    const avail = lineAvailable(state);
    const draw = Math.min(need, avail);
    if (draw > 0) {
      f.lineDrawn += draw;
      f.autoDrawn += draw;
      ledger(state, "line_draw", draw, `Drew $${Math.round(draw).toLocaleString()} on the line to cover the day's cash shortfall (variation margin, interest, payments)`);
    }
    if (f.cashUSD < -0.005) {
      const amount = -f.cashUSD;
      if (!f.marginCall) {
        f.marginCall = { amount, dueTick: nextCloseTick, raisedTick: state.tick };
        f.marginCalls += 1;
        return { raised: true, met: false, amount };
      }
      f.marginCall.amount = amount;
      return { raised: false, met: false, amount };
    }
  }
  if (f.marginCall) {
    f.marginCall = null;
    return { raised: false, met: true, amount: 0 };
  }
  return { raised: false, met: false, amount: 0 };
}

export function maintenanceLevel(state: State): number {
  return state.finance.marginRequired * MAINTENANCE_MARGIN_SHARE.value;
}

/** Daily interest on the drawn line at base plus the spread. */
export function accrueInterest(state: State): number {
  const f = state.finance;
  if (f.lineDrawn <= 0) return 0;
  const rate = state.world.baseRate + FINANCE.lineSpreadBp.value / 10000;
  const interest = (f.lineDrawn * rate) / 365;
  ledger(state, "interest", -interest, `Interest on $${Math.round(f.lineDrawn).toLocaleString()} drawn at ${(rate * 100).toFixed(2)}% (base ${(state.world.baseRate * 100).toFixed(2)}% + ${FINANCE.lineSpreadBp.value} bp), one day`);
  f.interestAccrued += interest;
  state.pnl.interest += interest;
  return interest;
}

export function drawLine(state: State, amount: number): string | null {
  const f = state.finance;
  if (f.lineCut) return "the bank has cut the line after the covenant breach";
  if (amount <= 0) return "amount must be positive";
  if (amount > lineAvailable(state) + 1e-6) return `the line has $${Math.round(lineAvailable(state)).toLocaleString()} available (after open letters of credit), not $${Math.round(amount).toLocaleString()}`;
  f.lineDrawn += amount;
  ledger(state, "line_draw", amount, `Drew $${Math.round(amount).toLocaleString()} on the credit line`);
  return null;
}
export function repayLine(state: State, amount: number): string | null {
  const f = state.finance;
  if (amount <= 0) return "amount must be positive";
  if (amount > f.lineDrawn + 1e-6) return `only $${Math.round(f.lineDrawn).toLocaleString()} is drawn`;
  if (amount > f.cashUSD + 1e-6) return `cash is $${Math.round(f.cashUSD).toLocaleString()}; cannot repay $${Math.round(amount).toLocaleString()}`;
  f.lineDrawn -= amount;
  ledger(state, "line_repay", -amount, `Repaid $${Math.round(amount).toLocaleString()} of the credit line`);
  return null;
}
export function convertFx(state: State, eur: number): string | null {
  // positive eur = buy EUR with USD; negative = sell EUR for USD, at spot with no fee (stylised)
  const fx = state.factors.eurusd;
  if (eur === 0) return "amount must be non-zero";
  if (eur < 0 && -eur > state.finance.cashEUR + 1e-6) return `EUR balance is ${Math.round(state.finance.cashEUR).toLocaleString()}`;
  if (eur > 0 && eur * fx > state.finance.cashUSD + 1e-6) return `cash is $${Math.round(state.finance.cashUSD).toLocaleString()}; buying EUR ${Math.round(eur).toLocaleString()} needs $${Math.round(eur * fx).toLocaleString()}`;
  ledger(state, "fx", -eur * fx, `${eur > 0 ? "Bought" : "Sold"} EUR ${Math.abs(Math.round(eur)).toLocaleString()} at ${fx.toFixed(4)}`, "USD");
  ledger(state, "fx", eur, `${eur > 0 ? "Bought" : "Sold"} EUR ${Math.abs(Math.round(eur)).toLocaleString()} at ${fx.toFixed(4)}`, "EUR");
  return null;
}

/** Equity: cash in both currencies, margin held, less the line, plus unrealised P&L since the last settle. */
export function equity(state: State, unrealised: number): number {
  const f = state.finance;
  return f.cashUSD + f.cashEUR * state.factors.eurusd + f.marginAccount - f.lineDrawn + unrealised;
}

/** Revalue the EUR cash balance at the current EURUSD; the change is the FX leg. Call before any EUR cash movement and at every settle. */
export function markEur(state: State): number {
  const f = state.finance;
  const fx = state.factors.eurusd;
  if (f.eurFxMark === 0) { f.eurFxMark = fx; return 0; }
  const leg = f.cashEUR * (fx - f.eurFxMark);
  if (Math.abs(leg) >= 0.005) state.pnl.attribution.push({ tick: state.tick, inst: "TTF", month: "", leg: "fx", amount: leg, text: `EURUSD moved from ${f.eurFxMark.toFixed(4)} to ${fx.toFixed(4)} on a EUR balance of ${Math.round(f.cashEUR).toLocaleString()}.` });
  f.eurFxMark = fx;
  return leg;
}

/** What the line can still lend: the limit less what is drawn and less the face of every open letter of credit. */
export function lineAvailable(state: State): number {
  if (state.finance.lineCut) return 0;
  return Math.max(0, state.finance.lineLimit - state.finance.lineDrawn - lcCommitted(state));
}
export function lcCommitted(state: State): number {
  return state.lcs.filter((l) => l.closedTick === null).reduce((a, l) => a + l.faceUsd, 0);
}

/** Open a letter of credit in favour of a cargo's seller: a fee of 0.25% of face per quarter, and the face uses the line. */
export function openLc(state: State, cargo: Cargo, faceUsd: number): { lc: LetterOfCredit | null; refusal: string | null } {
  const quarters = Math.max(1, Math.ceil(((cargo.laycan[1] + 45) * 24 - state.tick) / (90 * 24)));
  const fee = faceUsd * FINANCE.lcFeePerQuarter.value * quarters;
  if (faceUsd > lineAvailable(state) + 1e-6) return { lc: null, refusal: `a letter of credit for $${Math.round(faceUsd).toLocaleString()} needs that much of the line; $${Math.round(lineAvailable(state)).toLocaleString()} is available` };
  const lc: LetterOfCredit = { id: `LC${++state.counters.lc}`, cargoId: cargo.id, beneficiary: cargo.purchase.counterparty, faceUsd, feeUsd: fee, openedTick: state.tick, closedTick: null };
  state.lcs.push(lc);
  cargo.lcId = lc.id;
  ledger(state, "fee", -fee, `Letter of credit ${lc.id} fee: ${(FINANCE.lcFeePerQuarter.value * 100).toFixed(2)}% of $${Math.round(faceUsd).toLocaleString()} for ${quarters} quarter${quarters > 1 ? "s" : ""}`);
  state.pnl.attribution.push({ tick: state.tick, inst: "BRENT", month: cargo.id, leg: "finance", amount: -fee, text: `Letter of credit ${lc.id} for ${GRADES[cargo.grade].name} ${cargo.id}: a fee of ${(FINANCE.lcFeePerQuarter.value * 100).toFixed(2)}% of face per quarter (stylised), and $${Math.round(faceUsd).toLocaleString()} of the line held until the invoice is paid.` });
  return { lc, refusal: null };
}
export function closeLc(state: State, cargo: Cargo): void {
  const lc = state.lcs.find((l) => l.id === cargo.lcId && l.closedTick === null);
  if (lc) lc.closedTick = state.tick;
}

/** Non-performance cover on a cargo's counterparties: a premium now; a recovery if a covered default costs money. */
export function insureCargo(state: State, cargo: Cargo, valueUsd: number): number {
  const premium = valueUsd * CREDIT.insurancePremiumShare.value;
  cargo.insured = true;
  ledger(state, "fee", -premium, `Non-performance insurance on ${GRADES[cargo.grade].name} ${cargo.id}: ${(CREDIT.insurancePremiumShare.value * 100).toFixed(1)}% of $${Math.round(valueUsd).toLocaleString()}`);
  state.pnl.attribution.push({ tick: state.tick, inst: "BRENT", month: cargo.id, leg: "finance", amount: -premium, text: `Insurance premium on ${GRADES[cargo.grade].name} ${cargo.id}: ${(CREDIT.insurancePremiumShare.value * 100).toFixed(1)}% of the cargo's value (stylised); pays ${Math.round(CREDIT.insuranceRecovery.value * 100)}% of a loss on a counterparty default.` });
  return premium;
}

/** The covenant: a drawdown beyond the stated share of capital cuts the line to what is already drawn or committed. */
export function checkCovenant(state: State): EngineEvent[] {
  const f = state.finance;
  if (f.lineCut) return [];
  if (state.risk.maxDrawdown <= FINANCE.covenantDrawdown.value * state.capital) return [];
  f.lineCut = true;
  f.lineLimit = f.lineDrawn + lcCommitted(state);
  const text = `Nordbank: the drawdown of $${Math.round(state.risk.maxDrawdown).toLocaleString()} breaches the covenant (${Math.round(FINANCE.covenantDrawdown.value * 100)}% of capital, stylised). The line is cut to what is drawn and committed: $${Math.round(f.lineLimit).toLocaleString()}. No new draws.`;
  state.risk.messages.push({ tick: state.tick, text, severity: "breach" });
  return [{ kind: "finance", tick: state.tick, text, pause: true }];
}
