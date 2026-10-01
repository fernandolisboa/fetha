import Decimal from "decimal.js";
import type { DecimalString, Instant, SessionDate, Ticker } from "@fetha/contracts";
import type { CorporateActionFactor, EngineError, MarketView, OptionSeries } from "../api";
import { sessionAtOrBefore } from "./calendar";
import { PRICE_SCALE, parseDecimal, toDecimalString } from "./decimal";
import { compareInstants, isAtOrBefore } from "./instant";
import { isEarlierOnExactTie, resolveSeries } from "./resolve-series";

export type OptionStrikeAdjustment = "none" | "derived" | "unconfirmed";

export type ResolvedOptionStrike = {
  series: OptionSeries;
  strike: DecimalString;
  adjustment: OptionStrikeAdjustment;
};

export type ResolveOptionStrikeResult =
  { ok: true; value: ResolvedOptionStrike } | { ok: false; error: EngineError };

export type StrikeResolver = (series: OptionSeries) => ResolveOptionStrikeResult;

export function createOptionStrikeResolver(
  view: MarketView,
  underlying: Ticker,
  atSession: SessionDate | null,
  at: Instant,
): StrikeResolver {
  const cache = new Map<Ticker, ResolveOptionStrikeResult>();
  return (series: OptionSeries) => {
    const cached = cache.get(series.ticker);
    if (cached) return cached;
    const result = resolveOptionStrike(view, series.ticker, underlying, atSession, at);
    cache.set(series.ticker, result);
    return result;
  };
}

function minSession(a: SessionDate, b: SessionDate): SessionDate {
  return a < b ? a : b;
}

function sessionOfAsOf(view: MarketView, asOf: Instant): SessionDate {
  return sessionAtOrBefore(view.calendar, asOf)?.date ?? asOf.slice(0, 10);
}

// Two `optionSeries` rows can share an exact (ticker, asOf) — a true data-integrity duplicate,
// never a re-listing (a re-listing always advances `asOf`) — and `MarketView.optionSeries`'s own
// row order is not meaningful (I3). Collapsed here, before any transition is ever built, to the
// one row `resolveSeries` itself would pick for that exact instant (`isEarlierOnExactTie`), so
// the chain of transitions below is a pure function of the row *set*, never of array order
//.
//
// Also required to share `series`'s own `expiry` and `right`: a
// B3 ticker can be reused for an unrelated later cycle with a different expiry or right, and that
// reused ticker's own earlier-cycle rows must never join this chain just because they happen to
// share the ticker string.
function visibleEpochsAscending(
  view: MarketView,
  ticker: Ticker,
  series: OptionSeries,
  at: Instant,
): OptionSeries[] {
  const visible = view.optionSeries.filter(
    (s) =>
      s.ticker === ticker &&
      s.expiry === series.expiry &&
      s.right === series.right &&
      isAtOrBefore(s.asOf, at),
  );
  const byAsOf = new Map<Instant, OptionSeries>();
  for (const row of visible) {
    const current = byAsOf.get(row.asOf);
    if (!current || isEarlierOnExactTie(row, current)) byAsOf.set(row.asOf, row);
  }
  return [...byAsOf.values()].sort((a, b) => compareInstants(a.asOf, b.asOf));
}

// Duplicate (ticker, exDate) corporate-action rows are rejected as `invalid_input` upfront
// (`corporateActionIntegrityError`, `validate-view-integrity.ts`), so `exDate` is always unique
// here and no tie-break is needed.
function sortedFactorsAscending(
  factors: readonly CorporateActionFactor[],
): CorporateActionFactor[] {
  return [...factors].sort((a, b) => (a.exDate < b.exDate ? -1 : 1));
}

// One-to-one matching between a ticker's own strike transitions (consecutive visible epochs,
// oldest first) and the underlying's own visible corporate-action factors. The original check matched a factor against *any* earlier
// epoch whose scaled strike happened to equal the latest one, many-to-one: a second, epoch-less
// factor identical to an already-reflected one (the common case of two repeated split ratios,
// e.g. two 2-for-1 splits, both factor 0.5) was silently credited with an event it did not
// itself produce. Factors are walked oldest ex-date first; each claims the earliest
// not-yet-claimed transition whose target strike equals its own source strike times the factor,
// rounded half-up to the cent (`Decimal.ROUND_HALF_UP`, B3's own convention) — so the earliest
// factor always gets first claim on the transition that actually followed it, and nothing is
// double-counted or stolen out of order.
//
// A factor may only claim transition `i` (`epochs[i - 1]` -> `epochs[i]`) when its own `exDate`
// is strictly after the session the source epoch (`epochs[i - 1]`) was itself listed under
//. Without this, an unrelated, chronologically
// earlier factor — e.g. a split of the underlying from years before this series even listed —
// can coincidentally multiply the source epoch's strike into the target epoch's strike and
// falsely claim a transition it could not possibly have caused, stealing the claim from the real,
// later factor that actually produced it and leaving that real factor to be misread as
// unconfirmed or double-applied.
//
// Residual this still cannot rule out (documented, not fixed — the data alone cannot
// distinguish it, and the window is one cent wide): a non-split re-strike (a cash-dividend
// epoch, which carries no factor of its own) can coincide numerically with `round(P x F, 2)`
// for an unrelated, genuinely unreflected factor `F`. Example: a dividend re-strike 27.19 ->
// 24.72, then a 10% bonus (`F` = 0.90909...) with no epoch of its own: 27.19 x F also rounds to
// 24.72, so the bonus is wrongly read as already reflected. Low-probability (a one-cent
// coincidence between two unrelated events) and, like every other residual in this file, flagged
// as `"none"` rather than refused — a silent wrong number only in the sense that every adjacent
// residual already is.
function consumedFactors(
  view: MarketView,
  epochs: readonly OptionSeries[],
  factors: readonly CorporateActionFactor[],
): Set<CorporateActionFactor> {
  const claimed = new Set<CorporateActionFactor>();
  const consumedTransitions = new Set<number>();
  for (const factor of sortedFactorsAscending(factors)) {
    const multiplier = new Decimal(factor.factor);
    for (let i = 1; i < epochs.length; i++) {
      if (consumedTransitions.has(i)) continue;
      const from = epochs[i - 1];
      const to = epochs[i];
      if (!from || !to) continue;
      if (!(factor.exDate > sessionOfAsOf(view, from.asOf))) continue;
      const candidate = parseDecimal(from.strike)
        .mul(multiplier)
        .toDecimalPlaces(PRICE_SCALE, Decimal.ROUND_HALF_UP);
      if (candidate.eq(parseDecimal(to.strike))) {
        consumedTransitions.add(i);
        claimed.add(factor);
        break;
      }
    }
  }
  return claimed;
}

// An option leg's strike at an instant.
//
// `E`, the latest epoch visible at `at` (`resolveSeries`), already carries B3's own re-struck
// strike once a new epoch has been ingested for a corporate action. `through = min(atSession,
// E.expiry)` is the window's own upper bound (compared against
// `through`, never the uncapped `atSession`, below — a factor ex-dated on the series' own last
// session can never get an epoch of its own no matter how much later it is read, so the result
// must be the same `"derived"` at every later read instant too). `W` is the underlying's own
// visible factors whose `exDate` falls in `(session(E.asOf), through]`. Every factor in `W`
// already claimed by a real strike transition (`consumedFactors`, one-to-one across every
// visible factor with `exDate <= through`, not just `W` — an earlier, out-of-window factor can
// still claim the transition a later, in-window one would otherwise be mistaken for, but only
// when that earlier factor's own `exDate` falls after the transition's own starting epoch's
// session; a factor that predates the starting epoch itself can never claim it, correctness
//) is dropped.
//
// Whatever is left in `W` after that:
// - any factor exactly ex-dated on `through` itself (the live gap: that session's own
//   close-stamped epoch cannot exist yet, since an epoch is only ever stamped at a session's
//   close) is applied — `E.strike` times the product of every such factor, rounded half-up to
//   the cent — and the result is `"derived"`, noted `option_strike_derived_across_corporate_action`.
// - any other remaining factor (ex-dated strictly before `through`, with no epoch of its own
//   reflecting it) cannot be told apart from a genuine ingestion gap (a stale epoch the registry
//   has simply not caught up to yet) versus an early-dated epoch the registry already backfilled
//   correctly (ADR-0056 backfill step 2: the latest strike under the registry's first sighting) —
//   both look identical from here. `E.strike` is kept, unscaled, and the result is
//   `"unconfirmed"`, noted with the legacy `option_strike_unadjusted_across_corporate_action`
//   code (meaning, as of this rule, "this strike may not reflect a corporate action"): a wrong
//   number is never silent. A mix of both kinds in the same window reads conservatively as
//   `"unconfirmed"`, since the genuinely uncertain factor is still there either way.
export function resolveOptionStrike(
  view: MarketView,
  ticker: Ticker,
  underlying: Ticker,
  atSession: SessionDate | null,
  at: Instant,
): ResolveOptionStrikeResult {
  const series = resolveSeries(view, ticker, at);
  if (!series) return { ok: false, error: { code: "missing_instrument", ticker } };

  if (atSession === null) {
    return { ok: true, value: { series, strike: series.strike, adjustment: "none" } };
  }

  const sessionOfE = sessionOfAsOf(view, series.asOf);
  const through = minSession(atSession, series.expiry);

  const visibleFactors = view.corporateActions.filter(
    (f) => f.ticker === underlying && isAtOrBefore(f.asOf, at) && f.exDate <= through,
  );

  for (const f of visibleFactors) {
    if (!new Decimal(f.factor).gt(0)) {
      return {
        ok: false,
        error: {
          code: "invalid_input",
          path: "corporateActions[].factor",
          message: "a corporate-action factor must be positive",
        },
      };
    }
  }

  const windowFactors = visibleFactors.filter((f) => f.exDate > sessionOfE);

  const epochs = visibleEpochsAscending(view, ticker, series, at);
  const claimed = consumedFactors(view, epochs, visibleFactors);
  const remaining = windowFactors.filter((f) => !claimed.has(f));

  if (remaining.length === 0) {
    return { ok: true, value: { series, strike: series.strike, adjustment: "none" } };
  }

  const stale = remaining.filter((f) => f.exDate !== through);
  if (stale.length > 0) {
    return { ok: true, value: { series, strike: series.strike, adjustment: "unconfirmed" } };
  }

  let acc = new Decimal(1);
  for (const f of remaining) acc = acc.mul(new Decimal(f.factor));
  const derivedStrike = parseDecimal(series.strike).mul(acc);
  return {
    ok: true,
    value: { series, strike: toDecimalString(derivedStrike, PRICE_SCALE), adjustment: "derived" },
  };
}
