import Decimal from "decimal.js";
import type { DecimalString, Instant, RiskProfile, SessionDate } from "@fetha/contracts";
import type {
  EngineError,
  Greeks,
  LegInput,
  MarkToMarketInput,
  MarketView,
  Note,
  Operation,
  OperationValuation,
  PortfolioValuation,
  Provenance,
  Result,
} from "../api";
import { sessionAtOrBefore } from "./calendar";
import {
  CENTAVOS_PER_REAL,
  RATIO_SCALE,
  ZERO_RATIO,
  parseDecimal,
  toDecimalString,
} from "./decimal";
import { isAtOrBefore } from "./instant";
import { codeUnitCompare, sortUnique } from "./order";
import { validateOperationCoherence } from "./operation-coherence";
import { priceConcreteLegs, resolveOperationRates } from "./price-operation";
import { resolveLegMarketPrice, resolveUnderlyingSpot } from "./resolve-market-price";
import { toCentavos } from "./scalars";
import { splitFactorProduct } from "./split-factor";

type ProvenanceBase = Pick<
  Provenance,
  "engineVersion" | "pricingModel" | "dataVersion" | "datasetNotes"
>;

const zeroGreeks: Greeks = {
  delta: ZERO_RATIO,
  gamma: ZERO_RATIO,
  theta: ZERO_RATIO,
  vega: ZERO_RATIO,
  rho: ZERO_RATIO,
};

function invalidInput(path: string, message: string): EngineError {
  return { code: "invalid_input", path, message };
}

function err(error: EngineError): Result<PortfolioValuation> {
  return { ok: false, error };
}

function sign(side: "buy" | "sell"): 1 | -1 {
  return side === "buy" ? 1 : -1;
}

function isPositive(value: DecimalString): boolean {
  return parseDecimal(value).gt(0);
}

// The operation's own legs, priced fresh at `at` through the same `valueLegs`/
// `priceConcreteLegs` seam `priceOperation` uses (ADR-0013 #25 addendum: markToMarket never
// re-implements pricing). Unrealized P&L is computed separately below, per leg, against each
// leg's `entryPrice` on the scale the operation was opened at.
function priceExistingOperation(
  view: MarketView,
  at: Instant,
  operation: Operation,
  riskProfile: RiskProfile | undefined,
  openOperationCount: number,
  provenanceBase: ProvenanceBase,
  markSession: SessionDate | null,
): { ok: true; value: OperationValuation } | { ok: false; error: EngineError } {
  const spot = resolveUnderlyingSpot(view, operation.underlying, at);
  if (!spot)
    return { ok: false, error: { code: "missing_instrument", ticker: operation.underlying } };
  if (!isPositive(spot)) {
    return {
      ok: false,
      error: invalidInput("operations[].spot", "the underlying's spot must be positive"),
    };
  }

  const rates = resolveOperationRates(view, at, operation.underlying);
  if (!rates.ok) return { ok: false, error: rates.error };

  const legInputs: LegInput[] = operation.legs.map((leg) => ({
    role: leg.role,
    side: leg.side,
    ticker: leg.ticker,
    quantity: leg.quantity,
  }));

  const pricingResult = priceConcreteLegs(
    view,
    at,
    operation.underlying,
    spot,
    rates.riskFreeRate,
    rates.dividendYield,
    rates.notes,
    legInputs,
    riskProfile,
    openOperationCount,
    provenanceBase,
  );
  if (!pricingResult.ok) return { ok: false, error: pricingResult.error };
  const pricing = pricingResult.value;

  let unrealizedPnl = new Decimal(0);
  operation.legs.forEach((leg, index) => {
    const valuation = pricing.legs[index];
    const mark = valuation?.price ?? valuation?.fairValue ?? null;
    const entry = parseDecimal(leg.entryPrice);

    // A leg with neither a market price nor a solvable fair value (`no_market_price` /
    // `iv_not_converged`, already noted on `pricing`) contributes zero unrealized P&L rather
    // than an unknown or fabricated one, since `OperationValuation.unrealizedPnl` is a plain
    // `Centavos`, never `null` (ADR-0013 #25 addendum).
    let markOnEntryScale: Decimal;
    if (mark === null) {
      markOnEntryScale = entry;
    } else if (leg.role === "stock" && markSession !== null) {
      const visibleFactors = view.corporateActions.filter(
        (f) => f.ticker === leg.ticker && isAtOrBefore(f.asOf, at),
      );
      const factor = splitFactorProduct(visibleFactors, operation.openedAt, markSession);
      markOnEntryScale = parseDecimal(mark).div(factor);
    } else {
      markOnEntryScale = parseDecimal(mark);
    }

    unrealizedPnl = unrealizedPnl.add(
      markOnEntryScale.sub(entry).mul(sign(leg.side)).mul(CENTAVOS_PER_REAL).mul(leg.quantity),
    );
  });

  return {
    ok: true,
    value: {
      operation,
      pricing,
      unrealizedPnl: toCentavos(unrealizedPnl.round().toNumber()),
    },
  };
}

export function markToMarket(
  input: MarkToMarketInput,
  provenanceBase: ProvenanceBase,
): Result<PortfolioValuation> {
  const opIdDupe = sortUnique(
    input.operations,
    (op) => op.id,
    (a, b) => codeUnitCompare(a.id, b.id),
  );
  if (!opIdDupe.ok) {
    return err(invalidInput("operations", `duplicate operation id ${opIdDupe.duplicateKey}`));
  }

  const positionDupe = sortUnique(
    input.positions,
    (p) => p.ticker,
    (a, b) => codeUnitCompare(a.ticker, b.ticker),
  );
  if (!positionDupe.ok) {
    return err(invalidInput("positions", `duplicate position for ${positionDupe.duplicateKey}`));
  }

  for (const [index, operation] of input.operations.entries()) {
    const coherenceError = validateOperationCoherence(
      input.view,
      operation,
      input.at,
      `operations[${String(index)}]`,
    );
    if (coherenceError) return err(coherenceError);
  }

  const markSession = sessionAtOrBefore(input.view.calendar, input.at)?.date ?? null;

  const operationValuations: OperationValuation[] = [];
  for (const operation of input.operations) {
    const result = priceExistingOperation(
      input.view,
      input.at,
      operation,
      input.riskProfile,
      input.operations.length - 1,
      provenanceBase,
      markSession,
    );
    if (!result.ok) return err(result.error);
    operationValuations.push(result.value);
  }

  const notes: Note[] = [];
  if (!input.riskProfile) {
    notes.push({
      code: "no_risk_profile",
      message: "no risk profile supplied; limits not checked",
    });
  }

  const positionValuations: PortfolioValuation["positions"] = [];
  let anyPositionUnpriced = false;
  for (const position of input.positions) {
    const resolved = resolveLegMarketPrice(
      input.view,
      position.ticker,
      input.at,
      undefined,
      markSession,
      "stock",
    );
    const price = resolved?.value ?? null;
    const positionNotes: Note[] = [];
    if (price === null) {
      anyPositionUnpriced = true;
      positionNotes.push({
        code: "no_market_price",
        message: "no market price visible for this position",
      });
    } else if (resolved?.stale) {
      positionNotes.push({
        code: "stale_price",
        message: "mark carried forward from the series' last trade (ADR-0014 Q42)",
      });
    }

    const value =
      price !== null
        ? toCentavos(
            parseDecimal(price).mul(position.quantity).mul(CENTAVOS_PER_REAL).round().toNumber(),
          )
        : null;
    const unrealizedPnl =
      price !== null
        ? toCentavos(
            parseDecimal(price)
              .sub(parseDecimal(position.averageCost))
              .mul(position.quantity)
              .mul(CENTAVOS_PER_REAL)
              .round()
              .toNumber(),
          )
        : null;

    positionValuations.push({
      position,
      price,
      priceSource: resolved?.source ?? null,
      stale: resolved?.stale ?? null,
      value,
      unrealizedPnl,
      notes: positionNotes,
    });
  }
  if (anyPositionUnpriced) {
    notes.push({
      code: "no_market_price",
      message: "at least one position has no visible market price",
    });
  }

  // ADR-0013 "markToMarket": totals are cash plus position values only; operations are an
  // attribution view over the same fills and never add to totals (ADR-0013 #25 addendum
  // extends this to `unrealizedPnl`, for the same double-counting reason). `Position` carries
  // no role, strike or expiry, so greeks have no meaning for a bare position; `totals.greeks`
  // is therefore the sum of the operations' own aggregate greeks, the only artifact in this
  // call with the structured leg information greeks need.
  const equity = toCentavos(
    input.cash + positionValuations.reduce((acc, p) => acc + (p.value ?? 0), 0),
  );
  const unrealizedPnlTotal = toCentavos(
    positionValuations.reduce((acc, p) => acc + (p.unrealizedPnl ?? 0), 0),
  );
  const greeks: Greeks = (["delta", "gamma", "theta", "vega", "rho"] as const).reduce(
    (acc, key) => {
      const total = operationValuations.reduce(
        (sum, ov) => sum.add(parseDecimal(ov.pricing.greeks[key])),
        new Decimal(0),
      );
      return { ...acc, [key]: toDecimalString(total, RATIO_SCALE) };
    },
    { ...zeroGreeks },
  );

  const limitBreaches = operationValuations.flatMap((ov) => ov.pricing.limitBreaches);

  return {
    ok: true,
    value: {
      at: input.at,
      positions: positionValuations,
      operations: operationValuations,
      totals: { equity, cash: input.cash, unrealizedPnl: unrealizedPnlTotal, greeks },
      limitBreaches,
      notes,
      provenance: { ...provenanceBase, truncated: [] },
    },
  };
}
