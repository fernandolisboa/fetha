import Decimal from "decimal.js";
import type { Centavos, DecimalString, Instant, SessionDate } from "@fetha/contracts";
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
import { CENTAVOS_PER_REAL, PRICE_SCALE, RATIO_SCALE, parseDecimal, toDecimalString } from "./decimal";
import { evaluateStrategy as computeEvaluateStrategy } from "./evaluate-strategy";
import { fillCosts, resolveFillOpportunity } from "./fill-pricing";
import { invalidInput } from "./errors";
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

function validateAndMatchRealizedFills(
  operation: Operation,
  decidedAt: Instant,
  horizonClose: Instant,
  realizedFills: readonly Fill[],
): { ok: true; value: LegClosure[] } | { ok: false; error: EngineError } {
  const closedByLeg = new Map<number, number>();
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
    const legIndex = operation.legs.findIndex((leg) => leg.ticker === fill.ticker);
    if (legIndex === -1) {
      return {
        ok: false,
        error: invalidInput(`${path}.ticker`, "no operation leg matches this fill's ticker"),
      };
    }
    const leg = operation.legs[legIndex];
    if (!leg || fill.side !== opposite(leg.side)) {
      return {
        ok: false,
        error: invalidInput(`${path}.side`, "a realized fill must close its leg (opposite side)"),
      };
    }
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
  }
  return {
    ok: true,
    value: [...closedByLeg.entries()].map(([legIndex, closed]) => ({ legIndex, closed })),
  };
}

function computeOperationPnl(
  view: MarketView,
  decidedAt: Instant,
  horizonSession: SessionDate,
  horizonClose: Instant,
  operation: Operation,
  realizedFills: readonly Fill[],
): { ok: true; value: Centavos } | { ok: false; error: EngineError } {
  const matched = validateAndMatchRealizedFills(operation, decidedAt, horizonClose, realizedFills);
  if (!matched.ok) return matched;
  const closedByLeg = new Map(matched.value.map((c) => [c.legIndex, c.closed]));

  let pnl = new Decimal(0);
  for (const fill of realizedFills) {
    const legIndex = operation.legs.findIndex((leg) => leg.ticker === fill.ticker);
    const leg = operation.legs[legIndex];
    if (!leg) continue;
    pnl = pnl.add(
      parseDecimal(fill.price)
        .sub(parseDecimal(leg.entryPrice))
        .mul(sign(leg.side))
        .mul(CENTAVOS_PER_REAL)
        .mul(fill.quantity),
    );
    pnl = pnl.sub(fill.costs);
  }

  for (const [legIndex, leg] of operation.legs.entries()) {
    const remaining = leg.quantity - (closedByLeg.get(legIndex) ?? 0);
    if (remaining <= 0) continue;
    const factorResult = legSplitFactor(
      view,
      leg.ticker,
      operation.openedAt,
      horizonSession,
      horizonClose,
    );
    if (!factorResult.ok) return factorResult;
    const factor = factorResult.value;
    const resolved = resolveLegMarketPrice(
      view,
      leg.ticker,
      horizonClose,
      undefined,
      horizonSession,
      leg.role === "stock" ? "stock" : "option",
    );
    const effectiveEntry = parseDecimal(leg.entryPrice).mul(factor);
    const mark = resolved?.value ? parseDecimal(resolved.value) : effectiveEntry;
    pnl = pnl.add(
      mark
        .sub(effectiveEntry)
        .mul(sign(leg.side))
        .mul(CENTAVOS_PER_REAL)
        .mul(new Decimal(remaining).div(factor)),
    );
  }

  return { ok: true, value: toCentavos(pnl.round().toNumber()) };
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
        if (!opportunity?.ready) {
          throw new Error("findFillSession: unreachable, opportunity must be ready");
        }
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
  horizonSession: SessionDate,
  horizonClose: Instant,
): { ok: true; value: Decimal } | { ok: false; error: EngineError } {
  let pnl = new Decimal(0);
  for (const leg of legs) {
    const factorResult = legSplitFactor(view, leg.ticker, openedAt, horizonSession, horizonClose);
    if (!factorResult.ok) return factorResult;
    const factor = factorResult.value;
    const resolved = resolveLegMarketPrice(
      view,
      leg.ticker,
      horizonClose,
      undefined,
      horizonSession,
      leg.role === "stock" ? "stock" : "option",
    );
    const effectiveEntry = parseDecimal(leg.entryPrice).mul(factor);
    const mark = resolved?.value ? parseDecimal(resolved.value) : effectiveEntry;
    pnl = pnl.add(
      mark
        .sub(effectiveEntry)
        .mul(sign(leg.side))
        .mul(CENTAVOS_PER_REAL)
        .mul(new Decimal(leg.quantity).div(factor)),
    );
  }
  return { ok: true, value: pnl };
}

function computeCounterfactual(
  input: ScoreInput,
  operation: Operation,
  horizonSession: TradingSession,
  provenanceBase: ProvenanceBase,
): { ok: true; pnl: Centavos | null; notes: Note[] } | { ok: false; error: EngineError } {
  const decidedAtSession = sessionAtOrBefore(input.view.calendar, input.decidedAt);
  // Already validated non-null by the caller.
  /* v8 ignore next */
  if (!decidedAtSession) throw new Error("computeCounterfactual: decidedAt must resolve a session");

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
    const marked = markLegsToHorizon(
      input.view,
      filledLegs,
      entryOpportunity.session.date,
      horizonSession.date,
      horizonSession.close,
    );
    if (!marked.ok) return marked;
    const pnl = marked.value.sub(entryCosts);
    return { ok: true, pnl: toCentavos(pnl.round().toNumber()), notes: [] };
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
    const marked = markLegsToHorizon(
      input.view,
      filledLegs,
      entryOpportunity.session.date,
      horizonSession.date,
      horizonSession.close,
    );
    if (!marked.ok) return marked;
    const pnl = marked.value.sub(entryCosts);
    return { ok: true, pnl: toCentavos(pnl.round().toNumber()), notes: [] };
  }

  if (operation.expiry !== null && operation.expiry <= horizonSession.date) {
    const settlement = computeProposeSettlement(
      { view: input.view, operation: { ...syntheticOperation, expiry: operation.expiry } },
      provenanceBase,
    );
    if (!settlement.ok) return { ok: false, error: settlement.error };
    let pnl = new Decimal(0).sub(entryCosts);
    for (const legSettlement of settlement.value.legs) {
      const leg = legSettlement.leg;
      const factorResult = legSplitFactor(
        input.view,
        leg.ticker,
        entryOpportunity.session.date,
        horizonSession.date,
        horizonSession.close,
      );
      if (!factorResult.ok) return factorResult;
      const factor = factorResult.value;
      const effectiveEntry = parseDecimal(leg.entryPrice).mul(factor);
      const effectiveQuantity = new Decimal(leg.quantity).div(factor);
      if (legSettlement.outcome === "kept") {
        const resolved = resolveLegMarketPrice(
          input.view,
          leg.ticker,
          horizonSession.close,
          undefined,
          horizonSession.date,
          "stock",
        );
        const mark = resolved?.value ? parseDecimal(resolved.value) : effectiveEntry;
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
    return { ok: true, pnl: toCentavos(pnl.round().toNumber()), notes: [] };
  }

  const marked = markLegsToHorizon(
    input.view,
    filledLegs,
    entryOpportunity.session.date,
    horizonSession.date,
    horizonSession.close,
  );
  if (!marked.ok) return marked;
  const pnl = marked.value.sub(entryCosts);
  return { ok: true, pnl: toCentavos(pnl.round().toNumber()), notes: [] };
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
  if (claim.kind === "close_above" || claim.kind === "close_below") {
    const rows = input.view.candles.filter(
      (c) =>
        c.ticker === claim.instrument && c.timeframe === "D1" && c.session === horizonSession.date,
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
  } else {
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
        input.decidedAt,
        horizonSession.date,
        horizonSession.close,
        operation,
        input.realizedFills,
      );
      if (!pnlResult.ok) return err(pnlResult.error);
      pnl = pnlResult.value;
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
