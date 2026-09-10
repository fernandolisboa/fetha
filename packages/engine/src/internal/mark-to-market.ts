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
  Result,
} from "../api";
import { sessionAtOrBefore, sessionByDate } from "./calendar";
import { CENTAVOS_PER_REAL, RATIO_SCALE, parseDecimal, toDecimalString } from "./decimal";
import { invalidInput } from "./errors";
import { GREEK_KEYS, zeroGreeks } from "./greeks";
import { isAtOrBefore } from "./instant";
import { codeUnitCompare, sortUnique } from "./order";
import { validateOperationCoherence } from "./operation-coherence";
import { priceLegsAt } from "./price-operation";
import type { ProvenanceBase } from "./provenance";
import { resolveLegMarketPrice } from "./resolve-market-price";
import { toCentavos, toQuantity } from "./scalars";
import { splitFactorProduct } from "./split-factor";
import { validateViewIntegrity } from "./validate-view-integrity";
import { latestVisible } from "./visible";

function err(error: EngineError): Result<PortfolioValuation> {
  return { ok: false, error };
}

function sign(side: "buy" | "sell"): 1 | -1 {
  return side === "buy" ? 1 : -1;
}

function insufficientCandles(underlying: string, at: Instant): EngineError {
  return {
    code: "insufficient_data",
    needed: {
      from: at,
      to: at,
      instruments: [underlying],
      timeframes: ["D1"],
      collections: ["candles"],
    },
  };
}

// A operation whose listed expiry has passed by the mark session still has to be marked
// (round 1 item 3): the usual pricing seam would reject every option leg with `invalid_input`
// ("already_expired"), aborting the whole portfolio's valuation. Resolving the underlying's
// own close at the expiry session — the same instant `proposeSettlement` prices intrinsic
// value from — gives `valueOneLeg` a basis to value those legs at intrinsic instead.
function resolveExpiredIntrinsicBasis(
  view: MarketView,
  operation: Operation,
  markSession: SessionDate,
): { ok: true; value: DecimalString | null } | { ok: false; error: EngineError } {
  if (operation.expiry === null) return { ok: true, value: null };
  if (markSession < operation.expiry) return { ok: true, value: null };

  const expirySession = sessionByDate(view.calendar, operation.expiry);
  if (!expirySession) {
    return {
      ok: false,
      error: insufficientCandles(operation.underlying, `${operation.expiry}T00:00:00.000Z`),
    };
  }
  const candle = latestVisible(
    view.candles.filter(
      (c) =>
        c.ticker === operation.underlying && c.timeframe === "D1" && c.session === operation.expiry,
    ),
    expirySession.close,
  );
  if (!candle) {
    return { ok: false, error: insufficientCandles(operation.underlying, expirySession.close) };
  }
  return { ok: true, value: candle.close };
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
  markSession: SessionDate,
  path: string,
): { ok: true; value: OperationValuation } | { ok: false; error: EngineError } {
  const expiredBasis = resolveExpiredIntrinsicBasis(view, operation, markSession);
  if (!expiredBasis.ok) return { ok: false, error: expiredBasis.error };

  // ADR-0014 Q51: `Operation.legs` stay nominal at every step, so every leg's own effective
  // count (`quantity / F`) and effective entry price (`entryPrice × F`) are computed here, on
  // the ticker's own visible split/reverse-split factors between `openedAt` and the mark
  // session — never just the stock leg's, since an unrebased quantity fed into pricing reads
  // exposure, greeks and max loss off by F (round 1 item 2). An option leg's own ticker never
  // carries a corporate-action factor (a split forces a series rollover, ADR-0013 #25
  // addendum), so this naturally leaves option legs untouched (F = 1).
  const rebasedLegs: {
    leg: (typeof operation.legs)[number];
    factor: Decimal;
    effectiveQuantity: number;
  }[] = [];
  for (const leg of operation.legs) {
    const visibleFactors = view.corporateActions.filter(
      (f) => f.ticker === leg.ticker && isAtOrBefore(f.asOf, at),
    );
    const factorResult = splitFactorProduct(visibleFactors, operation.openedAt, markSession);
    if (!factorResult.ok) return { ok: false, error: factorResult.error };
    const effectiveQuantity = new Decimal(leg.quantity).div(factorResult.value).floor().toNumber();
    rebasedLegs.push({ leg, factor: factorResult.value, effectiveQuantity });
  }

  const legInputs: LegInput[] = rebasedLegs.map(({ leg, effectiveQuantity }) => ({
    role: leg.role,
    side: leg.side,
    ticker: leg.ticker,
    quantity: toQuantity(effectiveQuantity),
  }));

  const pricingResult = priceLegsAt(
    view,
    at,
    operation.underlying,
    legInputs,
    riskProfile,
    openOperationCount,
    provenanceBase,
    `${path}.spot`,
    expiredBasis.value,
  );
  if (!pricingResult.ok) return { ok: false, error: pricingResult.error };
  const pricing = pricingResult.value;

  let unrealizedPnl = new Decimal(0);
  rebasedLegs.forEach(({ leg, factor, effectiveQuantity }, index) => {
    const valuation = pricing.legs[index];
    const mark = valuation?.price ?? valuation?.fairValue ?? null;
    const effectiveEntry = parseDecimal(leg.entryPrice).mul(factor);

    // A leg with neither a market price nor a solvable fair value (`no_market_price` /
    // `iv_not_converged`, already noted on `pricing`) contributes zero unrealized P&L rather
    // than an unknown or fabricated one, since `OperationValuation.unrealizedPnl` is a plain
    // `Centavos`, never `null` (ADR-0013 #25 addendum). Both the mark (from `pricing`, already
    // on the post-factor scale) and `effectiveEntry` sit on the same scale as
    // `effectiveQuantity`, the count fed to `pricing` above (ADR-0014 Q51).
    const markOnEffectiveScale = mark === null ? effectiveEntry : parseDecimal(mark);

    unrealizedPnl = unrealizedPnl.add(
      markOnEffectiveScale
        .sub(effectiveEntry)
        .mul(sign(leg.side))
        .mul(CENTAVOS_PER_REAL)
        .mul(effectiveQuantity),
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
  const viewIntegrityError = validateViewIntegrity(input.view);
  if (viewIntegrityError) return err(viewIntegrityError);

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

  // A calendar that does not cover `at` cannot tell a split from a stale mark from a fresh
  // one: `resolveLegMarketPrice`'s stale flag and every leg's split-factor rebasing both need
  // the mark session, and silently treating it as "no session" understated both (round 1
  // item 8). Fail loudly instead of degrading.
  const markSession = sessionAtOrBefore(input.view.calendar, input.at)?.date ?? null;
  if (markSession === null) {
    return err({
      code: "insufficient_data",
      needed: {
        from: input.at,
        to: input.at,
        instruments: [],
        timeframes: [],
        collections: [],
      },
    });
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

  const operationValuations: OperationValuation[] = [];
  for (const [index, operation] of input.operations.entries()) {
    const result = priceExistingOperation(
      input.view,
      input.at,
      operation,
      input.riskProfile,
      input.operations.length - 1,
      provenanceBase,
      markSession,
      `operations[${String(index)}]`,
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

  // A generic "at least one leg/position has no visible market price" note does not say
  // which one; the portfolio level is the one place that can name it (round 1 item 9).
  for (const ov of operationValuations) {
    if (ov.pricing.notes.some((n) => n.code === "no_market_price")) {
      notes.push({
        code: "no_market_price",
        message: `operation ${ov.operation.id} has at least one leg with no visible market price`,
      });
    }
  }

  const positionValuations: PortfolioValuation["positions"] = [];
  const unpricedPositionTickers: string[] = [];
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
      unpricedPositionTickers.push(position.ticker);
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
  if (unpricedPositionTickers.length > 0) {
    notes.push({
      code: "no_market_price",
      message: `no visible market price for position(s): ${unpricedPositionTickers.join(", ")}`,
    });
  }

  // ADR-0013 "markToMarket": totals are cash plus position values only; operations are an
  // attribution view over the same fills and never add to totals (ADR-0013 #25 addendum
  // extends this to `unrealizedPnl`, for the same double-counting reason). `Position` carries
  // no role, strike or expiry, so most greeks have no meaning for a bare position, but delta
  // does: a stock position's delta is always 1 per share, signed by its `SignedQuantity`
  // (round 1 item 9), so `totals.greeks.delta` sums every operation's own aggregate delta
  // *and* every priced position's own quantity; the other four greeks stay operations-only,
  // the only artifact with the structured leg information they need.
  const equity = toCentavos(
    input.cash + positionValuations.reduce((acc, p) => acc + (p.value ?? 0), 0),
  );
  const unrealizedPnlTotal = toCentavos(
    positionValuations.reduce((acc, p) => acc + (p.unrealizedPnl ?? 0), 0),
  );
  const positionsDelta = positionValuations.reduce(
    (sum, p) => (p.price !== null ? sum.add(p.position.quantity) : sum),
    new Decimal(0),
  );
  const greeks: Greeks = GREEK_KEYS.reduce(
    (acc, key) => {
      const operationsTotal = operationValuations.reduce(
        (sum, ov) => sum.add(parseDecimal(ov.pricing.greeks[key])),
        new Decimal(0),
      );
      const total = key === "delta" ? operationsTotal.add(positionsDelta) : operationsTotal;
      return { ...acc, [key]: toDecimalString(total, RATIO_SCALE) };
    },
    { ...zeroGreeks },
  );

  // `maxOpenOperations` is a portfolio-wide count, not a per-operation one: every operation's
  // own pricing call checks it against the same `operations.length` (ADR-0013 "totals ...
  // openOperationCount"), so a breach shows up identically on every operation's own
  // `pricing.limitBreaches` and flattening them naively reported N identical breaches
  // (round 1 item 4). Report it at most once here, at the portfolio level, and flatten only
  // the genuinely per-operation limits from each operation's own pricing.
  const perOperationBreaches = operationValuations.flatMap((ov) =>
    ov.pricing.limitBreaches.filter((b) => b.limit !== "maxOpenOperations"),
  );
  const openOperationsBreach = operationValuations
    .flatMap((ov) => ov.pricing.limitBreaches)
    .find((b) => b.limit === "maxOpenOperations");
  const limitBreaches = openOperationsBreach
    ? [...perOperationBreaches, openOperationsBreach]
    : perOperationBreaches;

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
