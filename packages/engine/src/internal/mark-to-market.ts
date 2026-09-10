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
import { assertDefined, invariant } from "./invariant";
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

type ExpiredIntrinsicBasis =
  | { kind: "not_expired" }
  | { kind: "basis"; value: DecimalString }
  | { kind: "missing_candle" }
  | { kind: "error"; error: EngineError };

// A operation whose listed expiry has passed by the mark session still has to be marked
// (round 1 item 3): the usual pricing seam would reject every option leg with `invalid_input`
// ("already_expired"), aborting the whole portfolio's valuation. Resolving the underlying's
// own close at the expiry session — the same instant `proposeSettlement` prices intrinsic
// value from — gives `valueOneLeg` a basis to value those legs at intrinsic instead. A calendar
// that does not even cover the expiry session at all is a harder data gap than a missing
// candle (there is no session close to even name a truncation instant from) and still fails
// the whole call; a missing candle on an otherwise-known session is reported as its own `kind`
// so the caller can keep valuing the rest of the operation and the rest of the portfolio
// instead of aborting (round 3 item 5).
function resolveExpiredIntrinsicBasis(
  view: MarketView,
  operation: Operation,
  at: Instant,
  markSession: SessionDate,
): ExpiredIntrinsicBasis {
  if (operation.expiry === null) return { kind: "not_expired" };
  if (markSession < operation.expiry) return { kind: "not_expired" };

  const expirySession = sessionByDate(view.calendar, operation.expiry);
  if (!expirySession) {
    return {
      kind: "error",
      error: insufficientCandles(operation.underlying, `${operation.expiry}T00:00:00.000Z`),
    };
  }
  // On the expiry session itself, the operation is only actually expired once the session's
  // own close has passed: pricing it at intrinsic any earlier — even a moment before close —
  // would read the expiry candle before it is visible at `at` (I1). `at`'s own session already
  // being strictly later than `operation.expiry` (the `markSession < operation.expiry` guard
  // above already ruled out the earlier case) means `at` is necessarily at or after that close.
  if (markSession === operation.expiry && !isAtOrBefore(expirySession.close, at)) {
    return { kind: "not_expired" };
  }
  const truncationInstant = isAtOrBefore(at, expirySession.close) ? at : expirySession.close;
  const candle = latestVisible(
    view.candles.filter(
      (c) =>
        c.ticker === operation.underlying && c.timeframe === "D1" && c.session === operation.expiry,
    ),
    truncationInstant,
  );
  if (!candle) return { kind: "missing_candle" };
  return { kind: "basis", value: candle.close };
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
  const expiredBasis = resolveExpiredIntrinsicBasis(view, operation, at, markSession);
  if (expiredBasis.kind === "error") return { ok: false, error: expiredBasis.error };
  const missingExpiryCandle = expiredBasis.kind === "missing_candle";
  const basisValue = expiredBasis.kind === "basis" ? expiredBasis.value : null;

  // ADR-0014 Q51: `Operation.legs` stay nominal at every step, so every leg's own effective
  // count (`quantity / F`) and effective entry price (`entryPrice × F`) are computed here, on
  // the ticker's own visible split/reverse-split factors between `openedAt` and the mark
  // session — never just the stock leg's, since an unrebased quantity fed into pricing reads
  // exposure, greeks and max loss off by F (round 1 item 2). An option leg's own ticker never
  // carries a corporate-action factor (a split forces a series rollover, ADR-0013 #25
  // addendum), so this naturally leaves option legs untouched (F = 1). `rawEffectiveQuantity`
  // is kept unrounded throughout: the effective count is never rounded mid-run (Q51), so every
  // leg's own unrealized P&L below is computed on it directly, matching `runBacktest`'s own
  // mark and P&L (round 3 item 2) rather than the integer count `toQuantity` needs for pricing.
  const rebasedLegs: {
    leg: (typeof operation.legs)[number];
    legIndex: number;
    factor: Decimal;
    rawEffectiveQuantity: Decimal;
  }[] = [];
  for (const [legIndex, leg] of operation.legs.entries()) {
    const visibleFactors = view.corporateActions.filter(
      (f) => f.ticker === leg.ticker && isAtOrBefore(f.asOf, at),
    );
    const factorResult = splitFactorProduct(visibleFactors, operation.openedAt, markSession);
    if (!factorResult.ok) return { ok: false, error: factorResult.error };
    const rawEffectiveQuantity = new Decimal(leg.quantity).div(factorResult.value);
    rebasedLegs.push({ leg, legIndex, factor: factorResult.value, rawEffectiveQuantity });
  }

  // `toQuantity` throws for a floored effective count of zero (an odd lot dissolved below one
  // unit by a grouping — `F >= leg.quantity`) and for one a near-zero `F` blows past a safe
  // integer; neither is a caller mistake `toQuantity`'s own invariant should catch (round 3
  // item 2, mirroring `runBacktest`'s identical guard). The former excludes the leg from
  // `legInputs` — there is no positive `Quantity` below one to give it, so it cannot appear in
  // `pricing.legs` or the aggregate greeks/payoff `priceConcreteLegs` computes from that array
  // — the latter is `invalid_input`, indexed at this leg. An expired operation whose expiry
  // candle is missing (`missingExpiryCandle`) excludes its own option legs the same way — there
  // is no basis to value them at intrinsic and no time-to-expiry left to price them any other
  // way — rather than aborting the whole call (round 3 item 5); a stock leg is never affected,
  // since `valueOneLeg` never consults `expiredIntrinsicBasis` for one.
  const legInputs: LegInput[] = [];
  const legInputIndexByLegIndex = new Map<number, number>();
  const residueOnlyLegIndexes = new Set<number>();
  const unpricedExpiredLegIndexes = new Set<number>();
  for (const { leg, legIndex, rawEffectiveQuantity } of rebasedLegs) {
    if (missingExpiryCandle && leg.role !== "stock") {
      unpricedExpiredLegIndexes.add(legIndex);
      continue;
    }
    const floored = rawEffectiveQuantity.floor().toNumber();
    if (floored <= 0) {
      residueOnlyLegIndexes.add(legIndex);
      continue;
    }
    if (!Number.isSafeInteger(floored)) {
      return {
        ok: false,
        error: invalidInput(
          `${path}.legs[${String(legIndex)}]`,
          "a corporate-action factor produces a non-integer-safe effective quantity for this leg",
        ),
      };
    }
    legInputIndexByLegIndex.set(legIndex, legInputs.length);
    legInputs.push({
      role: leg.role,
      side: leg.side,
      ticker: leg.ticker,
      quantity: toQuantity(floored),
    });
  }

  const pricingResult = priceLegsAt(
    view,
    at,
    operation.underlying,
    legInputs,
    riskProfile,
    openOperationCount,
    provenanceBase,
    `${path}.spot`,
    basisValue,
  );
  if (!pricingResult.ok) return { ok: false, error: pricingResult.error };
  const pricing = pricingResult.value;

  let unrealizedPnl = new Decimal(0);
  for (const { leg, legIndex, factor, rawEffectiveQuantity } of rebasedLegs) {
    const effectiveEntry = parseDecimal(leg.entryPrice).mul(factor);
    let mark: DecimalString | null;
    if (residueOnlyLegIndexes.has(legIndex)) {
      // Only a stock leg's own ticker ever carries a factor != 1 (Q51: an option leg's factor
      // is always 1, a split forces a series rollover instead), so a residue-only leg can only
      // ever be a stock leg; its mark is resolved the same way a standalone `Position`'s is
      // below, never through `pricing.legs` since it was excluded from `legInputs` above.
      invariant(
        leg.role === "stock",
        "mark-to-market: only a stock leg's own factor can dissolve it below one effective unit",
      );
      const resolved = resolveLegMarketPrice(view, leg.ticker, at, undefined, markSession, "stock");
      // `leg.ticker` equals `operation.underlying` here (operation-coherence.ts), the same
      // ticker `priceLegsAt` already resolved a spot for through the identical quote/candle
      // ladder to get this far — a stale, but never a null, mark for a residue-only leg.
      /* v8 ignore next */
      mark = resolved?.value ?? null;
    } else if (unpricedExpiredLegIndexes.has(legIndex)) {
      // No expiry candle exists to resolve intrinsic value from and no time-to-expiry is left
      // to price this leg any other way (round 3 item 5); `null` folds through the same zero
      // unrealized-P&L path a `no_market_price` leg already takes below.
      mark = null;
    } else {
      const legInputIndex = assertDefined(
        legInputIndexByLegIndex.get(legIndex),
        "mark-to-market: every non-residue, non-unpriced-expired leg has a legInputs entry",
      );
      const valuation = pricing.legs[legInputIndex];
      mark = valuation?.price ?? valuation?.fairValue ?? null;
    }

    // A leg with neither a market price nor a solvable fair value (`no_market_price` /
    // `iv_not_converged`, already noted on `pricing`) contributes zero unrealized P&L rather
    // than an unknown or fabricated one, since `OperationValuation.unrealizedPnl` is a plain
    // `Centavos`, never `null` (ADR-0013 #25 addendum). Both the mark and `effectiveEntry` sit
    // on the same post-factor scale as `rawEffectiveQuantity`.
    const markOnEffectiveScale = mark === null ? effectiveEntry : parseDecimal(mark);

    unrealizedPnl = unrealizedPnl.add(
      markOnEffectiveScale
        .sub(effectiveEntry)
        .mul(sign(leg.side))
        .mul(CENTAVOS_PER_REAL)
        .mul(rawEffectiveQuantity),
    );
  }

  const notes: Note[] = [...pricing.notes];
  if (residueOnlyLegIndexes.size > 0) {
    notes.push({
      code: "less_than_one_effective_unit",
      message:
        "a corporate-action factor leaves at least one leg with less than one effective unit; excluded from pricing.legs and the aggregate greeks/payoff, its residual value is folded into unrealizedPnl",
    });
  }
  if (unpricedExpiredLegIndexes.size > 0) {
    notes.push({
      code: "no_market_price",
      message:
        "the operation's listed expiry has passed and no expiry-session candle is visible; at least one leg is excluded from pricing.legs and contributes zero unrealizedPnl pending that data",
    });
  }

  return {
    ok: true,
    value: {
      operation,
      pricing: { ...pricing, notes },
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
  // does: a stock position's delta is always 1 per share, signed by its `SignedQuantity`.
  // `totals.greeks.delta` sums every priced position's own quantity plus every operation's own
  // *option*-leg greeks only: an operation's own stock leg's delta is excluded from this sum,
  // since a stock leg opened through a tracked `Operation` is expected to also appear in
  // `positions` (the same reasoning `unrealizedPnl` above already follows) and summing both
  // would double count those shares (round 3 item 3, superseding round 1 item 9's "adds every
  // operation's own aggregate delta"). The other four greeks have no stock-leg contribution to
  // begin with (`valueOneLeg`'s stock branch only ever sets `delta`), so restricting them to
  // option legs changes nothing for them; they stay operations-only, the only artifact with
  // the structured leg information they need.
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
      const operationsOptionLegsTotal = operationValuations.reduce((sum, ov) => {
        const legsTotal = ov.pricing.legs.reduce((legSum, legValuation) => {
          if (legValuation.leg.role === "stock" || !legValuation.greeks) return legSum;
          return legSum.add(
            new Decimal(sign(legValuation.leg.side))
              .mul(legValuation.leg.quantity)
              .mul(legValuation.greeks[key]),
          );
        }, new Decimal(0));
        return sum.add(legsTotal);
      }, new Decimal(0));
      const total =
        key === "delta" ? operationsOptionLegsTotal.add(positionsDelta) : operationsOptionLegsTotal;
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
