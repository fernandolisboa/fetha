import Decimal from "decimal.js";
import type {
  Centavos,
  CostModel,
  DecimalString,
  Instant,
  SessionDate,
  Ticker,
} from "@fetha/contracts";
import type {
  EngineError,
  Fill,
  LegValuation,
  MarketView,
  Note,
  Operation,
  OperationLeg,
  PnlScore,
  Result,
  Score,
  ScoreInput,
  Side,
  ThesisScore,
  TradingSession,
} from "../api";
import { batchTruncationReport } from "./batch-truncation";
import { sessionAtOrBefore, sessionByDate, sortedCalendar } from "./calendar";
import {
  CENTAVOS_PER_REAL,
  PRICE_SCALE,
  RATIO_SCALE,
  parseDecimal,
  toDecimalString,
} from "./decimal";
import { evaluateStrategy as computeEvaluateStrategy } from "./evaluate-strategy";
import { fillCosts, resolveFillOpportunity } from "./fill-pricing";
import { invalidInput } from "./errors";
import { assertPresent, invariant } from "./invariant";
import { isAfter, isAtOrBefore } from "./instant";
import { computePayoffProfile, type PricedLeg } from "./price-operation";
import type { ProvenanceBase } from "./provenance";
import { proposeSettlement as computeProposeSettlement } from "./propose-settlement";
import { resolveLegMarketPrice, resolveUnderlyingSpot } from "./resolve-market-price";
import { resolveSeries } from "./resolve-series";
import { toCentavos, toQuantity } from "./scalars";
import { splitFactorProduct } from "./split-factor";
import { validateOperationCoherence } from "./operation-coherence";
import { validateViewIntegrity } from "./validate-view-integrity";
import { latestVisible } from "./visible";

function err(error: EngineError): Result<Score> {
  return { ok: false, error };
}

function opposite(side: Side): Side {
  return side === "buy" ? "sell" : "buy";
}

function sign(side: Side): 1 | -1 {
  return side === "buy" ? 1 : -1;
}

function legKind(leg: OperationLeg): "stock" | "option" {
  return leg.role === "stock" ? "stock" : "option";
}

// A leg with no visible price is never silently marked at its own entry price (that would
// report a fabricated zero P&L as if it were real, PR #29 round 1 item 3): both the
// taken-operation mark and the counterfactual mark refuse instead, naming the ticker and the
// collection (`candles` for a stock leg, `optionPrices` for an option leg) the nightly job's
// retry needs.
function noMarketPriceError(
  ticker: Ticker,
  kind: "stock" | "option",
  horizonSession: TradingSession,
): EngineError {
  return {
    code: "insufficient_data",
    needed: {
      from: horizonSession.open,
      to: horizonSession.close,
      instruments: [ticker],
      timeframes: ["D1"],
      collections: [kind === "stock" ? "candles" : "optionPrices"],
    },
  };
}

const NO_OPERATION_NOTE: Note = {
  code: "no_operation",
  message: "no operation to score against; only the thesis claim contributes (ADR-0014 Q46)",
};
const NO_THESIS_CLAIM_NOTE: Note = {
  code: "no_thesis_claim",
  message: "no thesis claim recorded; the journal shows this thesis as unscored",
};
const UNBOUNDED_MAX_LOSS_NOTE: Note = {
  code: "unbounded_max_loss",
  message: "the operation's max loss is unbounded; normalizedPnl is not computed",
};
const ZERO_MAX_LOSS_NOTE: Note = {
  code: "zero_max_loss",
  message: "the operation's max loss is zero; there is nothing to normalize pnl by",
};
const MISSED_ENTRY_NOTE: Note = {
  code: "missed_entry",
  message:
    "no fill opportunity for the untaken operation before the horizon; counterfactualPnl is null",
};

// A leg marked at a session earlier than the one it is being marked to (`resolveLegMarketPrice`'s
// own `stale` flag, ADR-0014 Q42) is still a valid mark, but the score should say so rather than
// let a carried-forward price pass as a fresh one (round 3 item 3): reuses the `stale_price`
// `NoteCode` markToMarket already uses for the same situation, with the ticker and session named
// since a score can mark several legs across several calls.
function staleMarkNote(ticker: Ticker, session: SessionDate): Note {
  return {
    code: "stale_price",
    message: `${ticker} marked at its last trade on ${session} (ADR-0014 Q42), not a fresh price for the horizon`,
  };
}

// ADR-0014 Q51: `Operation.legs` stay nominal at every step, so every leg's own effective
// share count and effective entry price are rebased by the product of every split/reverse-split
// factor visible at `at` between the operation's `openedAt` and `through` (mark-to-market's own
// `rebasedLegs`). An option leg's own ticker never carries a factor (a split forces a series
// rollover, ADR-0013 #25 addendum), so this is a no-op (F = 1) for every option leg.
function legSplitFactor(
  view: MarketView,
  ticker: string,
  openedAt: SessionDate,
  through: SessionDate,
  at: Instant,
): { ok: true; value: Decimal } | { ok: false; error: EngineError } {
  const factors = view.corporateActions.filter(
    (f) => f.ticker === ticker && isAtOrBefore(f.asOf, at),
  );
  return splitFactorProduct(factors, openedAt, through);
}

function dummyValuation(leg: OperationLeg): LegValuation {
  return {
    leg: { role: leg.role, side: leg.side, ticker: leg.ticker, quantity: leg.quantity },
    price: null,
    priceSource: null,
    stale: null,
    fairValue: null,
    impliedVolatility: null,
    volatilitySource: null,
    greeks: null,
    timeToExpiryYears: null,
    notes: [],
  };
}

function buildEntryPricedLegs(
  view: MarketView,
  at: Instant,
  openedAt: SessionDate,
  through: SessionDate,
  legs: readonly OperationLeg[],
): { ok: true; value: PricedLeg[] } | { ok: false; error: EngineError } {
  const priced: PricedLeg[] = [];
  for (const [legIndex, leg] of legs.entries()) {
    const factorResult = legSplitFactor(view, leg.ticker, openedAt, through, at);
    if (!factorResult.ok) return factorResult;
    const factor = factorResult.value;
    const effectiveQuantity = new Decimal(leg.quantity).div(factor).floor().toNumber();
    if (effectiveQuantity <= 0) {
      if (leg.role !== "stock") {
        return {
          ok: false,
          error: invalidInput(
            `operation.legs[${String(legIndex)}]`,
            "a corporate-action factor dissolves a non-stock leg below one effective unit",
          ),
        };
      }
      continue;
    }
    if (!Number.isSafeInteger(effectiveQuantity)) {
      return {
        ok: false,
        error: invalidInput(
          `operation.legs[${String(legIndex)}]`,
          "a corporate-action factor produces a non-integer-safe effective quantity for this leg",
        ),
      };
    }
    const effectiveLeg: OperationLeg = {
      ...leg,
      quantity: toQuantity(effectiveQuantity),
      entryPrice: toDecimalString(parseDecimal(leg.entryPrice).mul(factor), PRICE_SCALE),
    };
    if (leg.role === "stock") {
      priced.push({
        valuation: dummyValuation(effectiveLeg),
        strike: null,
        premiumPerUnit: parseDecimal(effectiveLeg.entryPrice),
      });
      continue;
    }
    const series = resolveSeries(view, leg.ticker, at);
    if (!series) return { ok: false, error: { code: "missing_instrument", ticker: leg.ticker } };
    priced.push({
      valuation: dummyValuation(effectiveLeg),
      strike: series.strike,
      premiumPerUnit: parseDecimal(effectiveLeg.entryPrice),
    });
  }
  return { ok: true, value: priced };
}

function computeOperationMaxLoss(
  view: MarketView,
  at: Instant,
  horizonSession: SessionDate,
  operation: Operation,
): { ok: true; value: Centavos | "unbounded" } | { ok: false; error: EngineError } {
  const spot = resolveUnderlyingSpot(view, operation.underlying, at);
  if (!spot)
    return { ok: false, error: { code: "missing_instrument", ticker: operation.underlying } };
  const legsResult = buildEntryPricedLegs(
    view,
    at,
    operation.openedAt,
    horizonSession,
    operation.legs,
  );
  if (!legsResult.ok) return legsResult;
  const { maxLoss } = computePayoffProfile(legsResult.value, spot);
  return { ok: true, value: maxLoss };
}

type LegClosure = { legIndex: number; closed: number };
type FillMatch = { closures: LegClosure[]; legIndexByFillIndex: number[] };

// A fill is matched to the leg it closes by ticker AND side (PR #29 round 1 item 7): matching
// by ticker alone cannot tell two legs on the same ticker but opposite sides apart (a covered
// combination), and two legs that share both ticker and side make the match ambiguous — the
// fill could be closing either one, so it is refused rather than guessed.
function validateAndMatchRealizedFills(
  operation: Operation,
  decidedAt: Instant,
  horizonClose: Instant,
  realizedFills: readonly Fill[],
): { ok: true; value: FillMatch } | { ok: false; error: EngineError } {
  const closedByLeg = new Map<number, number>();
  const legIndexByFillIndex: number[] = [];
  for (const [index, fill] of realizedFills.entries()) {
    const path = `realizedFills[${String(index)}]`;
    if (!isAfter(fill.at, decidedAt)) {
      return {
        ok: false,
        error: invalidInput(`${path}.at`, "a realized fill must be after decidedAt"),
      };
    }
    if (!isAtOrBefore(fill.at, horizonClose)) {
      return {
        ok: false,
        error: invalidInput(`${path}.at`, "a realized fill must be at or before the horizon close"),
      };
    }
    const tickerMatches = operation.legs
      .map((leg, legIndex) => ({ leg, legIndex }))
      .filter(({ leg }) => leg.ticker === fill.ticker);
    if (tickerMatches.length === 0) {
      return {
        ok: false,
        error: invalidInput(`${path}.ticker`, "no operation leg matches this fill's ticker"),
      };
    }
    const sideMatches = tickerMatches.filter(({ leg }) => fill.side === opposite(leg.side));
    if (sideMatches.length === 0) {
      return {
        ok: false,
        error: invalidInput(`${path}.side`, "a realized fill must close its leg (opposite side)"),
      };
    }
    if (sideMatches.length > 1) {
      return {
        ok: false,
        error: invalidInput(
          `${path}.ticker`,
          "two operation legs share this fill's ticker and side; the fill cannot be matched unambiguously",
        ),
      };
    }
    const match = sideMatches[0];
    invariant(
      match !== undefined,
      "validateAndMatchRealizedFills: sideMatches has exactly one element here",
    );
    const { legIndex, leg } = match;
    const already = closedByLeg.get(legIndex) ?? 0;
    const total = already + fill.quantity;
    if (total > leg.quantity) {
      return {
        ok: false,
        error: invalidInput(
          `${path}.quantity`,
          "realized fills close more than the leg's quantity",
        ),
      };
    }
    closedByLeg.set(legIndex, total);
    legIndexByFillIndex.push(legIndex);
  }
  return {
    ok: true,
    value: {
      closures: [...closedByLeg.entries()].map(([legIndex, closed]) => ({ legIndex, closed })),
      legIndexByFillIndex,
    },
  };
}

// Shared by the taken-operation path (computeOperationPnl) and the counterfactual's own
// expiry branch (ADR-0014 Q41): once an operation's expiry is at or before the horizon
// session, its legs settle rather than mark to an arbitrary post-expiry price — an expired
// option leg has no market price to mark at all. `proposeSettlement`'s own outcome (kept /
// exercised / assigned / expired_worthless) decides each leg's value at the expiry session
// close; a still-open stock leg (`kept`) is then carried forward to the horizon close, the
// only leg kind settlement leaves open.
function settlementPnl(
  view: MarketView,
  underlying: Ticker,
  expiry: SessionDate,
  legs: readonly OperationLeg[],
  openedAt: SessionDate,
  horizonSession: TradingSession,
  provenanceBase: ProvenanceBase,
): { ok: true; value: Decimal; notes: Note[] } | { ok: false; error: EngineError } {
  const syntheticOperation: Operation = {
    id: "settlement",
    underlying,
    legs: [...legs],
    expiry,
    openedAt,
    strategyVersionId: null,
    rolledFrom: null,
  };
  const settlement = computeProposeSettlement(
    { view, operation: syntheticOperation },
    provenanceBase,
  );
  if (!settlement.ok) return { ok: false, error: settlement.error };

  let pnl = new Decimal(0);
  const notes: Note[] = [];
  for (const legSettlement of settlement.value.legs) {
    const leg = legSettlement.leg;
    const factorResult = legSplitFactor(
      view,
      leg.ticker,
      openedAt,
      horizonSession.date,
      horizonSession.close,
    );
    if (!factorResult.ok) return factorResult;
    const factor = factorResult.value;
    const effectiveEntry = parseDecimal(leg.entryPrice).mul(factor);
    const effectiveQuantity = new Decimal(leg.quantity).div(factor);

    if (legSettlement.outcome === "kept") {
      const resolved = resolveLegMarketPrice(
        view,
        leg.ticker,
        horizonSession.close,
        undefined,
        horizonSession.date,
        "stock",
      );
      // `leg.ticker` here is always the operation's own underlying (a `kept` leg is a stock
      // leg, and a stock leg's ticker must match the underlying, operation-coherence.ts): the
      // settlement above already resolved a visible candle for that same ticker at or before
      // `horizonSession.close` (proposeSettlement's own underlying-close lookup, truncated at
      // the expiry close, which is at or before the horizon close) to get this far, so this
      // ladder — visible at a later-or-equal instant on the identical ticker — can never come
      // back empty; the guard only documents the invariant markLegsToHorizon enforces for real
      // for every other caller (round 1 item 3).
      /* v8 ignore start */
      if (!resolved?.value) {
        return { ok: false, error: noMarketPriceError(leg.ticker, "stock", horizonSession) };
      }
      /* v8 ignore stop */
      if (resolved.stale) notes.push(staleMarkNote(leg.ticker, resolved.stale.session));
      const mark = parseDecimal(resolved.value);
      pnl = pnl.add(
        mark.sub(effectiveEntry).mul(sign(leg.side)).mul(CENTAVOS_PER_REAL).mul(effectiveQuantity),
      );
      continue;
    }

    const settleValue = parseDecimal(legSettlement.intrinsicValue).mul(factor);
    pnl = pnl.add(
      settleValue
        .sub(effectiveEntry)
        .mul(sign(leg.side))
        .mul(CENTAVOS_PER_REAL)
        .mul(effectiveQuantity),
    );
  }
  return { ok: true, value: pnl, notes };
}

function computeOperationPnl(
  view: MarketView,
  costModel: CostModel,
  decidedAt: Instant,
  horizonSession: TradingSession,
  operation: Operation,
  realizedFills: readonly Fill[],
  provenanceBase: ProvenanceBase,
): { ok: true; value: Centavos; notes: Note[] } | { ok: false; error: EngineError } {
  const matched = validateAndMatchRealizedFills(
    operation,
    decidedAt,
    horizonSession.close,
    realizedFills,
  );
  if (!matched.ok) return matched;
  const closedByLeg = new Map(matched.value.closures.map((c) => [c.legIndex, c.closed]));

  let pnl = new Decimal(0);
  for (const [fillIndex, fill] of realizedFills.entries()) {
    const legIndex = matched.value.legIndexByFillIndex[fillIndex];
    invariant(
      legIndex !== undefined,
      "computeOperationPnl: every realized fill has a matched leg index",
    );
    const leg = operation.legs[legIndex];
    invariant(
      leg !== undefined,
      "computeOperationPnl: a matched legIndex must resolve an operation leg",
    );
    // ADR-0014 Q51: the fill's own entry basis is rebased by every split factor visible
    // through the fill's own session, the same rebasing the marked remainder gets below —
    // a fill realized after a split must not compare a pre-split entry price to a
    // post-split fill price.
    const factorResult = legSplitFactor(
      view,
      leg.ticker,
      operation.openedAt,
      fill.session,
      fill.at,
    );
    if (!factorResult.ok) return factorResult;
    const factor = factorResult.value;
    const effectiveEntry = parseDecimal(leg.entryPrice).mul(factor);
    pnl = pnl.add(
      parseDecimal(fill.price)
        .sub(effectiveEntry)
        .mul(sign(leg.side))
        .mul(CENTAVOS_PER_REAL)
        .mul(new Decimal(fill.quantity).div(factor)),
    );
    pnl = pnl.sub(fill.costs);
  }

  const remainingLegs: OperationLeg[] = [];
  for (const [legIndex, leg] of operation.legs.entries()) {
    const remaining = leg.quantity - (closedByLeg.get(legIndex) ?? 0);
    if (remaining <= 0) continue;
    remainingLegs.push({ ...leg, quantity: toQuantity(remaining) });
  }

  const notes: Note[] = [];
  if (remainingLegs.length > 0) {
    if (operation.expiry !== null && operation.expiry <= horizonSession.date) {
      const settled = settlementPnl(
        view,
        operation.underlying,
        operation.expiry,
        remainingLegs,
        operation.openedAt,
        horizonSession,
        provenanceBase,
      );
      if (!settled.ok) return settled;
      pnl = pnl.add(settled.value);
      notes.push(...settled.notes);
    } else {
      const marked = markLegsToHorizon(view, remainingLegs, operation.openedAt, horizonSession);
      if (!marked.ok) return marked;
      pnl = pnl.add(marked.value);
      notes.push(...marked.notes);
    }
  }

  // ADR-0014 Q54: the taken-operation pnl subtracts entry costs on the same fill-cost model
  // the counterfactual applies to its own entry (`fillCosts`, PR #29 round 1 item 4) — the
  // full nominal quantity of every leg, at its entry price, regardless of how much of it a
  // realized fill later closes. Realized fills keep their own recorded `costs`; a mark to the
  // horizon (or a settlement) carries no exit cost on either path.
  let entryCosts = 0;
  for (const leg of operation.legs) {
    entryCosts += fillCosts(costModel, leg.entryPrice, leg.quantity, legKind(leg));
  }
  pnl = pnl.sub(entryCosts);

  return { ok: true, value: toCentavos(pnl.round().toNumber()), notes };
}

type FillLeg = { leg: OperationLeg; price: DecimalString; costs: Centavos };

function findFillSession(
  view: MarketView,
  costModel: ScoreInput["costModel"],
  legs: readonly OperationLeg[],
  calendar: readonly TradingSession[],
  afterSession: SessionDate,
  throughSession: SessionDate,
  tradeSideOf: (leg: OperationLeg) => Side,
): { session: TradingSession; fills: FillLeg[] } | null {
  const candidates = sortedCalendar(calendar).filter(
    (s) => s.date > afterSession && s.date <= throughSession,
  );
  for (const session of candidates) {
    const opportunities = legs.map((leg) =>
      resolveFillOpportunity(view, costModel, leg, session, tradeSideOf(leg)),
    );
    if (opportunities.every((o) => o.ready)) {
      const fills: FillLeg[] = legs.map((leg, i) => {
        const opportunity = opportunities[i];
        // Every element of opportunities is ready here (the `every` guard above), so its
        // price/kind are always present; this narrows the union for TypeScript.
        invariant(
          opportunity !== undefined && opportunity.ready,
          "findFillSession: unreachable, opportunity must be ready",
        );
        return {
          leg,
          price: opportunity.price,
          costs: fillCosts(costModel, opportunity.price, leg.quantity, opportunity.kind),
        };
      });
      return { session, fills };
    }
  }
  return null;
}

function markLegsToHorizon(
  view: MarketView,
  legs: readonly OperationLeg[],
  openedAt: SessionDate,
  horizonSession: TradingSession,
): { ok: true; value: Decimal; notes: Note[] } | { ok: false; error: EngineError } {
  let pnl = new Decimal(0);
  const notes: Note[] = [];
  for (const leg of legs) {
    const factorResult = legSplitFactor(
      view,
      leg.ticker,
      openedAt,
      horizonSession.date,
      horizonSession.close,
    );
    if (!factorResult.ok) return factorResult;
    const factor = factorResult.value;
    const kind = legKind(leg);
    const resolved = resolveLegMarketPrice(
      view,
      leg.ticker,
      horizonSession.close,
      undefined,
      horizonSession.date,
      kind,
    );
    if (!resolved?.value) {
      return { ok: false, error: noMarketPriceError(leg.ticker, kind, horizonSession) };
    }
    if (resolved.stale) notes.push(staleMarkNote(leg.ticker, resolved.stale.session));
    const effectiveEntry = parseDecimal(leg.entryPrice).mul(factor);
    const mark = parseDecimal(resolved.value);
    pnl = pnl.add(
      mark
        .sub(effectiveEntry)
        .mul(sign(leg.side))
        .mul(CENTAVOS_PER_REAL)
        .mul(new Decimal(leg.quantity).div(factor)),
    );
  }
  return { ok: true, value: pnl, notes };
}

// The counterfactual's own close-out at the horizon (ADR-0014 Q41), shared by the manual-origin
// path and every signal-origin fallback that reaches the horizon without an exit fill (round 3
// item 1/2): an operation whose expiry is at or before the horizon session settles rather than
// marks, on the same rule `computeOperationPnl` applies to the taken operation — a counterfactual
// is not exempt from Q41 just because nothing was actually held.
function settleOrMarkCounterfactualToHorizon(
  view: MarketView,
  provenanceBase: ProvenanceBase,
  operation: Operation,
  filledLegs: OperationLeg[],
  entryOpportunitySession: SessionDate,
  horizonSession: TradingSession,
  entryCosts: number,
): { ok: true; pnl: Centavos; notes: Note[] } | { ok: false; error: EngineError } {
  if (operation.expiry !== null && operation.expiry <= horizonSession.date) {
    const settled = settlementPnl(
      view,
      operation.underlying,
      operation.expiry,
      filledLegs,
      entryOpportunitySession,
      horizonSession,
      provenanceBase,
    );
    if (!settled.ok) return { ok: false, error: settled.error };
    const pnl = settled.value.sub(entryCosts);
    return { ok: true, pnl: toCentavos(pnl.round().toNumber()), notes: settled.notes };
  }
  const marked = markLegsToHorizon(view, filledLegs, entryOpportunitySession, horizonSession);
  if (!marked.ok) return marked;
  const pnl = marked.value.sub(entryCosts);
  return { ok: true, pnl: toCentavos(pnl.round().toNumber()), notes: marked.notes };
}

function computeCounterfactual(
  input: ScoreInput,
  operation: Operation,
  horizonSession: TradingSession,
  provenanceBase: ProvenanceBase,
): { ok: true; pnl: Centavos | null; notes: Note[] } | { ok: false; error: EngineError } {
  // Already validated non-null by the caller.
  const decidedAtSession = assertPresent(
    sessionAtOrBefore(input.view.calendar, input.decidedAt),
    "computeCounterfactual: decidedAt must resolve a session",
  );

  const entryOpportunity = findFillSession(
    input.view,
    input.costModel,
    operation.legs,
    input.view.calendar,
    decidedAtSession.date,
    horizonSession.date,
    (leg) => leg.side,
  );
  if (!entryOpportunity) return { ok: true, pnl: null, notes: [MISSED_ENTRY_NOTE] };

  const entryCosts = entryOpportunity.fills.reduce((acc, f) => acc + f.costs, 0);
  const filledLegs: OperationLeg[] = entryOpportunity.fills.map((f) => ({
    role: f.leg.role,
    side: f.leg.side,
    ticker: f.leg.ticker,
    quantity: f.leg.quantity,
    entryPrice: f.price,
  }));

  if (input.origin.kind === "manual") {
    return settleOrMarkCounterfactualToHorizon(
      input.view,
      provenanceBase,
      operation,
      filledLegs,
      entryOpportunity.session.date,
      horizonSession,
      entryCosts,
    );
  }

  const instruments = [...new Set([operation.underlying, ...filledLegs.map((l) => l.ticker)])];
  const syntheticOperation: Operation = {
    id: "counterfactual",
    underlying: operation.underlying,
    legs: filledLegs,
    expiry: operation.expiry,
    openedAt: entryOpportunity.session.date,
    strategyVersionId: input.origin.strategy.id,
    rolledFrom: null,
  };

  const evaluation = computeEvaluateStrategy({
    view: input.view,
    strategy: input.origin.strategy,
    instruments,
    at: horizonSession.close,
    since: entryOpportunity.session.open,
    openOperations: [syntheticOperation],
  });
  if (!evaluation.ok) return { ok: false, error: evaluation.error };

  const exitSignals = evaluation.value.signals
    .filter((s) => s.kind === "exit" && s.operationId === "counterfactual")
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const exitSignal = exitSignals[0];

  if (exitSignal) {
    const exitOpportunity = findFillSession(
      input.view,
      input.costModel,
      filledLegs,
      input.view.calendar,
      exitSignal.session,
      horizonSession.date,
      (leg) => opposite(leg.side),
    );
    if (exitOpportunity) {
      const exitCosts = exitOpportunity.fills.reduce((acc, f) => acc + f.costs, 0);
      let pnl = new Decimal(0);
      for (const f of exitOpportunity.fills) {
        const factorResult = legSplitFactor(
          input.view,
          f.leg.ticker,
          entryOpportunity.session.date,
          exitOpportunity.session.date,
          exitOpportunity.session.close,
        );
        if (!factorResult.ok) return factorResult;
        const factor = factorResult.value;
        pnl = pnl.add(
          parseDecimal(f.price)
            .sub(parseDecimal(f.leg.entryPrice).mul(factor))
            .mul(sign(f.leg.side))
            .mul(CENTAVOS_PER_REAL)
            .mul(new Decimal(f.leg.quantity).div(factor)),
        );
      }
      pnl = pnl.sub(entryCosts).sub(exitCosts);
      return { ok: true, pnl: toCentavos(pnl.round().toNumber()), notes: [] };
    }
    return settleOrMarkCounterfactualToHorizon(
      input.view,
      provenanceBase,
      operation,
      filledLegs,
      entryOpportunity.session.date,
      horizonSession,
      entryCosts,
    );
  }

  return settleOrMarkCounterfactualToHorizon(
    input.view,
    provenanceBase,
    operation,
    filledLegs,
    entryOpportunity.session.date,
    horizonSession,
    entryCosts,
  );
}

function computeThesis(
  input: ScoreInput,
  horizonSession: TradingSession,
  pnl: Centavos | null,
  counterfactualPnl: Centavos | null,
): { ok: true; value: ThesisScore } | { ok: false; error: EngineError } {
  const claim = input.claim;
  if (claim === null) return { ok: true, value: { claim: null } };

  let held: boolean;
  switch (claim.kind) {
    case "close_above":
    case "close_below": {
      const rows = input.view.candles.filter(
        (c) =>
          c.ticker === claim.instrument &&
          c.timeframe === "D1" &&
          c.session === horizonSession.date,
      );
      const candle = latestVisible(rows, horizonSession.close);
      if (!candle) {
        return {
          ok: false,
          error: {
            code: "insufficient_data",
            needed: {
              from: horizonSession.open,
              to: horizonSession.close,
              instruments: [claim.instrument],
              timeframes: ["D1"],
              collections: ["candles"],
            },
          },
        };
      }
      const close = parseDecimal(candle.close);
      const level = parseDecimal(claim.level);
      held = claim.kind === "close_above" ? close.gt(level) : close.lt(level);
      break;
    }
    case "operation_pnl_positive": {
      const basis = input.subject === "do_not_enter" ? counterfactualPnl : pnl;
      if (basis === null) {
        return {
          ok: false,
          error: {
            code: "insufficient_data",
            needed: {
              from: horizonSession.open,
              to: horizonSession.close,
              instruments: [],
              timeframes: [],
              collections: [],
            },
          },
        };
      }
      held = basis > 0;
      break;
    }
    /* v8 ignore start */
    default: {
      const exhaustive: never = claim;
      throw new Error(`computeThesis: unhandled claim kind ${JSON.stringify(exhaustive)}`);
    }
    /* v8 ignore stop */
  }

  const heldValue = held ? 1 : 0;
  const brier = parseDecimal(input.confidence).sub(heldValue).pow(2);
  return { ok: true, value: { claim, held, brier: toDecimalString(brier, RATIO_SCALE) } };
}

function buildPnlScore(
  pnl: Centavos | null,
  maxLoss: Centavos | "unbounded" | null,
  normalizedPnl: DecimalString | null,
): PnlScore {
  if (pnl === null || maxLoss === null) return { pnl: null, maxLoss: null, normalizedPnl: null };
  if (maxLoss === "unbounded") return { pnl, maxLoss: "unbounded", normalizedPnl: null };
  return { pnl, maxLoss, normalizedPnl };
}

export function score(input: ScoreInput, provenanceBase: ProvenanceBase): Result<Score> {
  const viewIntegrityError = validateViewIntegrity(input.view);
  if (viewIntegrityError) return err(viewIntegrityError);

  const horizonSession = sessionByDate(input.view.calendar, input.horizon);
  if (!horizonSession)
    return err(invalidInput("horizon", "the horizon session is not in the calendar"));

  const decidedAtSession = sessionAtOrBefore(input.view.calendar, input.decidedAt);
  if (!decidedAtSession) {
    return err(invalidInput("decidedAt", "no calendar session covers decidedAt"));
  }
  if (horizonSession.date < decidedAtSession.date) {
    return err(invalidInput("horizon", "the horizon must not be before the session of decidedAt"));
  }
  // A claim judged on a close already public at decision time is look-ahead, not a forward
  // score: the horizon session's own close must fall strictly after decidedAt (PR #29 round 1
  // item 1), not merely on the same or a later calendar date.
  if (!isAfter(horizonSession.close, input.decidedAt)) {
    return err(
      invalidInput(
        "horizon",
        "the horizon session close must be strictly after decidedAt; it would otherwise be scored on a close already public at decision time",
      ),
    );
  }

  if (input.claim?.kind === "operation_pnl_positive" && !input.operation) {
    return err(invalidInput("claim", "operation_pnl_positive needs an operation to score against"));
  }

  const operation = input.operation;
  if (!operation) {
    if (input.realizedFills.length > 0) {
      return err(invalidInput("realizedFills", "realizedFills must be empty without an operation"));
    }
  } else {
    const coherenceError = validateOperationCoherence(
      input.view,
      operation,
      horizonSession.close,
      "operation",
    );
    if (coherenceError) return err(coherenceError);
    if (input.subject === "do_not_enter" && input.realizedFills.length > 0) {
      return err(
        invalidInput(
          "realizedFills",
          "do_not_enter must not carry realized fills; nothing was held",
        ),
      );
    }
  }

  const notes: Note[] = [];
  let pnl: Centavos | null = null;
  let maxLoss: Centavos | "unbounded" | null = null;
  let normalizedPnl: DecimalString | null = null;
  let counterfactualPnl: Centavos | null = null;

  if (!operation) {
    notes.push(NO_OPERATION_NOTE);
  } else {
    const maxLossResult = computeOperationMaxLoss(
      input.view,
      horizonSession.close,
      horizonSession.date,
      operation,
    );
    if (!maxLossResult.ok) return err(maxLossResult.error);
    maxLoss = maxLossResult.value;

    if (input.subject === "do_not_enter") {
      pnl = toCentavos(0);
    } else {
      const pnlResult = computeOperationPnl(
        input.view,
        input.costModel,
        input.decidedAt,
        horizonSession,
        operation,
        input.realizedFills,
        provenanceBase,
      );
      if (!pnlResult.ok) return err(pnlResult.error);
      pnl = pnlResult.value;
      notes.push(...pnlResult.notes);
    }

    if (maxLoss === "unbounded") {
      notes.push(UNBOUNDED_MAX_LOSS_NOTE);
    } else if (maxLoss === 0) {
      notes.push(ZERO_MAX_LOSS_NOTE);
    } else {
      normalizedPnl = toDecimalString(new Decimal(pnl).div(maxLoss), RATIO_SCALE);
    }

    if (input.subject === "do_not_enter") {
      const counterfactual = computeCounterfactual(
        input,
        operation,
        horizonSession,
        provenanceBase,
      );
      if (!counterfactual.ok) return err(counterfactual.error);
      counterfactualPnl = counterfactual.pnl;
      notes.push(...counterfactual.notes);
    }
  }

  const thesisResult = computeThesis(input, horizonSession, pnl, counterfactualPnl);
  if (!thesisResult.ok) return err(thesisResult.error);
  const thesis = thesisResult.value;
  if (thesis.claim === null) notes.push(NO_THESIS_CLAIM_NOTE);

  const instruments = new Set<string>();
  if (operation) {
    instruments.add(operation.underlying);
    for (const leg of operation.legs) instruments.add(leg.ticker);
  }
  if (input.claim && input.claim.kind !== "operation_pnl_positive") {
    instruments.add(input.claim.instrument);
  }

  const truncated = batchTruncationReport({
    candles: input.view.candles,
    corporateActions: input.view.corporateActions,
    impliedVolatilityIndex: input.view.impliedVolatilityIndex,
    macro: input.view.macro,
    dividendYields: input.view.dividendYields,
    instruments: [...instruments],
    at: horizonSession.close,
    needsIv: false,
  });

  return {
    ok: true,
    value: {
      ...buildPnlScore(pnl, maxLoss, normalizedPnl),
      thesis,
      counterfactualPnl,
      notes,
      provenance: { ...provenanceBase, truncated },
    },
  };
}
