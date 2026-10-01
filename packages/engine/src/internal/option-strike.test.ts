import { describe, expect, it } from "vitest";
import type { CorporateActionFactor, MarketView, OptionSeries } from "../api";
import { dailyCalendar, decimalString } from "../test/support";
import { resolveOptionStrike } from "./option-strike";

const calendar = dailyCalendar(2, 20);
const underlying = "BBAS3";
const ticker = "BBASD350";

const baseView: MarketView = {
  calendar,
  candles: [],
  corporateActions: [],
  optionSeries: [],
  optionPrices: [],
  quotes: [],
  macro: [],
  dividendYields: [],
  impliedVolatilityIndex: [],
};

function series(overrides: Partial<OptionSeries> = {}): OptionSeries {
  return {
    ticker,
    underlying,
    right: "call",
    strike: decimalString("27.19"),
    expiry: "2024-01-21",
    style: "european",
    asOf: "2024-01-02T21:00:00.000Z",
    ...overrides,
  };
}

function factor(overrides: Partial<CorporateActionFactor> = {}): CorporateActionFactor {
  return {
    ticker: underlying,
    exDate: "2024-01-08",
    asOf: "2024-01-08T13:00:00.000Z",
    factor: decimalString("0.5"),
    ...overrides,
  };
}

const settlementAt = "2024-01-19T21:00:00.000Z";
const settlementSession = "2024-01-19";

describe("resolveOptionStrike", () => {
  it("a second epoch dated before the real ex-date it reflects already carries the factor; the window never re-derives it", () => {
    // 27.19@01-02, 13.60@01-04 (an early-dated real epoch, not the ex-date's own close), factor
    // 0.5 ex 01-08: session(E.asOf) = 01-04, so the window (01-04, 01-19] still contains the
    // 01-08 factor, but the one-to-one match finds the earlier 27.19 epoch's own transition
    // already explains it (round_half_up(27.19 x 0.5, 2) = 13.60 = E.strike), so it is claimed
    // and dropped before the window is ever acted on.
    const earlyEpoch = series({ asOf: "2024-01-04T21:00:00.000Z", strike: decimalString("13.60") });
    const view: MarketView = {
      ...baseView,
      optionSeries: [series(), earlyEpoch],
      corporateActions: [factor()],
    };
    const result = resolveOptionStrike(view, ticker, underlying, settlementSession, settlementAt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.strike).toBe(decimalString("13.60"));
    expect(result.value.adjustment).toBe("none");
  });

  it("X1: a step-3 epoch backfilled even earlier, before the holding period this test used to anchor on, reads the same way — there is no entry instant left to compare against", () => {
    // 27.19@01-02, 13.60@01-05 (ADR-0056 step 3's own backfill, dated before 01-08's real
    // ex-date), factor 0.5 ex 01-08. The previous, entry-anchored rule mis-derived 6.80 for an
    // entry made between 01-05 and 01-08; this rule has no entry to anchor on at all, so it
    // reaches the same one-to-one match as blocking 1 above, regardless of any entry — still
    // 13.60, never double-applied.
    const backfilled = series({
      asOf: "2024-01-05T21:00:00.000Z",
      strike: decimalString("13.60"),
    });
    const view: MarketView = {
      ...baseView,
      optionSeries: [series(), backfilled],
      corporateActions: [factor()],
    };
    const result = resolveOptionStrike(view, ticker, underlying, settlementSession, settlementAt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.strike).toBe(decimalString("13.60"));
    expect(result.value.adjustment).toBe("none");
  });

  it("a factor ex-dated strictly before atSession, with no epoch reflecting it yet, keeps the strike unscaled and flags it unconfirmed — a wrong number is never silent", () => {
    // A single 28.00 epoch, factor ex 01-05, read at 01-08: nothing tells this apart from a
    // genuine ingestion gap versus an early-dated, already-adjusted epoch the registry
    // backfilled correctly (ADR-0056 step 2), so the strike is kept as-is and flagged, rather
    // than guessed either way.
    const singleEpoch = series({ strike: decimalString("28.00") });
    const laterFactor = factor({ exDate: "2024-01-05", asOf: "2024-01-05T13:00:00.000Z" });
    const view: MarketView = {
      ...baseView,
      optionSeries: [singleEpoch],
      corporateActions: [laterFactor],
    };
    const result = resolveOptionStrike(
      view,
      ticker,
      underlying,
      "2024-01-08",
      "2024-01-08T21:00:00.000Z",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.strike).toBe(decimalString("28.00"));
    expect(result.value.adjustment).toBe("unconfirmed");
  });

  it("the live D-open gap: the same single epoch, read at the ex-date session's own open, derives — that session's own close-stamped epoch cannot exist yet", () => {
    // Backtest fills happen at a session's open; a factor ex-dated exactly on `atSession` can
    // never have an epoch of its own visible this early in the same session, so there is
    // nothing ambiguous left to flag — it is applied.
    const singleEpoch = series({ strike: decimalString("28.00") });
    const sameDayFactor = factor({ exDate: "2024-01-05", asOf: "2024-01-05T13:00:00.000Z" });
    const view: MarketView = {
      ...baseView,
      optionSeries: [singleEpoch],
      corporateActions: [sameDayFactor],
    };
    const result = resolveOptionStrike(
      view,
      ticker,
      underlying,
      "2024-01-05",
      "2024-01-05T13:00:00.000Z",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.strike).toBe(decimalString("14.00"));
    expect(result.value.adjustment).toBe("derived");
  });

  it("two identical 0.5 factors are matched one-to-one, never many-to-one — the second never silently reads as already reflected", () => {
    // 27.19@01-02, 13.60@01-08 (the first 0.5 split's own real epoch), then a second,
    // epoch-less 0.5 split ex 01-12: the original many-to-one `isFactorReflected` matched the
    // second split's own factor against the transition the first split had already produced
    // (both round to a factor of 0.5 off the same kind of strike), silently reading "none" at
    // every read instant after 01-08. The one-to-one match instead claims that transition for
    // the first split alone (the earliest unclaimed one matching its own ex-date), leaving the
    // second split genuinely unexplained: "derived" at its own ex-date's own open, "unconfirmed"
    // afterward, never "none".
    const firstSplitEpoch = series({
      asOf: "2024-01-08T21:00:00.000Z",
      strike: decimalString("13.60"),
    });
    const secondSplit = factor({ exDate: "2024-01-12", asOf: "2024-01-12T13:00:00.000Z" });
    const view: MarketView = {
      ...baseView,
      optionSeries: [series(), firstSplitEpoch],
      // Listed later-ex-date-first, deliberately out of order: the one-to-one match sorts by
      // exDate itself, so the outcome must not depend on the view's own corporateActions order.
      corporateActions: [secondSplit, factor()],
    };
    const atOpen = resolveOptionStrike(
      view,
      ticker,
      underlying,
      "2024-01-12",
      "2024-01-12T13:00:00.000Z",
    );
    expect(atOpen.ok).toBe(true);
    if (!atOpen.ok) return;
    expect(atOpen.value.strike).toBe(decimalString("6.80"));
    expect(atOpen.value.adjustment).toBe("derived");

    const later = resolveOptionStrike(
      view,
      ticker,
      underlying,
      "2024-01-15",
      "2024-01-15T21:00:00.000Z",
    );
    expect(later.ok).toBe(true);
    if (!later.ok) return;
    expect(later.value.strike).toBe(decimalString("13.60"));
    expect(later.value.adjustment).toBe("unconfirmed");
    expect(later.value.adjustment).not.toBe("none");
  });

  it("a 3-epoch chain (40 -> 20 -> 10) with a third, epoch-less 0.5 split matches each factor to its own transition in order", () => {
    const first = series({ strike: decimalString("40.00"), asOf: "2024-01-02T21:00:00.000Z" });
    const second = series({ strike: decimalString("20.00"), asOf: "2024-01-05T21:00:00.000Z" });
    const third = series({ strike: decimalString("10.00"), asOf: "2024-01-08T21:00:00.000Z" });
    const firstFactor = factor({ exDate: "2024-01-05", asOf: "2024-01-05T13:00:00.000Z" });
    const secondFactor = factor({ exDate: "2024-01-08", asOf: "2024-01-08T13:00:00.000Z" });
    const thirdFactor = factor({ exDate: "2024-01-12", asOf: "2024-01-12T13:00:00.000Z" });
    const view: MarketView = {
      ...baseView,
      optionSeries: [first, second, third],
      corporateActions: [firstFactor, secondFactor, thirdFactor],
    };
    const atOpen = resolveOptionStrike(
      view,
      ticker,
      underlying,
      "2024-01-12",
      "2024-01-12T13:00:00.000Z",
    );
    expect(atOpen.ok).toBe(true);
    if (!atOpen.ok) return;
    expect(atOpen.value.strike).toBe(decimalString("5.00"));
    expect(atOpen.value.adjustment).toBe("derived");

    const later = resolveOptionStrike(
      view,
      ticker,
      underlying,
      "2024-01-15",
      "2024-01-15T21:00:00.000Z",
    );
    expect(later.ok).toBe(true);
    if (!later.ok) return;
    expect(later.value.strike).toBe(decimalString("10.00"));
    expect(later.value.adjustment).toBe("unconfirmed");
  });

  it("X3/X2 merged, dividend-in-between variant: 27.19 -> 26.95 (dividend, no factor) -> 13.48 (a real split), then an identical epoch-less second split", () => {
    const original = series();
    const dividendRestrike = series({
      asOf: "2024-01-05T21:00:00.000Z",
      strike: decimalString("26.95"),
    });
    const splitEpoch = series({
      asOf: "2024-01-08T21:00:00.000Z",
      strike: decimalString("13.48"),
    });
    const firstSplit = factor({ exDate: "2024-01-08", asOf: "2024-01-08T13:00:00.000Z" });
    const secondSplit = factor({ exDate: "2024-01-12", asOf: "2024-01-12T13:00:00.000Z" });
    const view: MarketView = {
      ...baseView,
      optionSeries: [original, dividendRestrike, splitEpoch],
      corporateActions: [firstSplit, secondSplit],
    };
    const atOpen = resolveOptionStrike(
      view,
      ticker,
      underlying,
      "2024-01-12",
      "2024-01-12T13:00:00.000Z",
    );
    expect(atOpen.ok).toBe(true);
    if (!atOpen.ok) return;
    expect(atOpen.value.strike).toBe(decimalString("6.74"));
    expect(atOpen.value.adjustment).toBe("derived");

    const later = resolveOptionStrike(
      view,
      ticker,
      underlying,
      "2024-01-15",
      "2024-01-15T21:00:00.000Z",
    );
    expect(later.ok).toBe(true);
    if (!later.ok) return;
    expect(later.value.strike).toBe(decimalString("13.48"));
    expect(later.value.adjustment).toBe("unconfirmed");
  });

  it("a cash-dividend re-strike epoch with no corporate-action factor anywhere in the view reads the latest epoch's strike", () => {
    const restruck = series({
      asOf: "2024-01-08T21:00:00.000Z",
      strike: decimalString("26.95"),
    });
    const view: MarketView = {
      ...baseView,
      optionSeries: [series(), restruck],
      corporateActions: [],
    };
    const result = resolveOptionStrike(view, ticker, underlying, settlementSession, settlementAt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.strike).toBe(decimalString("26.95"));
    expect(result.value.adjustment).toBe("none");
  });

  // #69 part 2, a duplicated (ticker, exDate) corporate-action
  // row is rejected as `invalid_input` upfront by every public caller of `resolveOptionStrike`
  // (`corporateActionIntegrityError`, exercised in mark-to-market.test.ts, propose-settlement.
  // test.ts, score.test.ts, price-operation.test.ts and run-backtest.test.ts), so
  // `resolveOptionStrike` itself is never reached with one and no longer needs its own case for
  // it.

  it("an unrelated factor ex-dated on or before the series' earlier epoch cannot claim a transition it could not have caused", () => {
    // 27.19@01-02, 13.60@01-05 (a step-3 early-dated epoch backfilled before the real ex-date it
    // reflects), plus an unrelated 0.5 split of the underlying from 2023-12-20 — before this
    // series even listed — and the real 0.5 split ex 2024-01-08. The 2023 split cannot be the
    // cause of the 01-02 -> 01-05 transition (it predates the 01-02 epoch's own listing session),
    // so only the real, later factor may claim it; nothing is left over to misread as derived or
    // unconfirmed.
    const backfilled = series({
      asOf: "2024-01-05T21:00:00.000Z",
      strike: decimalString("13.60"),
    });
    const unrelatedOldSplit = factor({
      exDate: "2023-12-20",
      asOf: "2023-12-20T13:00:00.000Z",
    });
    const realSplit = factor({ exDate: "2024-01-08", asOf: "2024-01-08T13:00:00.000Z" });
    const view: MarketView = {
      ...baseView,
      optionSeries: [series(), backfilled],
      corporateActions: [unrelatedOldSplit, realSplit],
    };
    const atOpen = resolveOptionStrike(
      view,
      ticker,
      underlying,
      "2024-01-08",
      "2024-01-08T13:00:00.000Z",
    );
    expect(atOpen.ok).toBe(true);
    if (!atOpen.ok) return;
    expect(atOpen.value.strike).toBe(decimalString("13.60"));
    expect(atOpen.value.adjustment).toBe("none");

    const later = resolveOptionStrike(
      view,
      ticker,
      underlying,
      "2024-01-15",
      "2024-01-15T21:00:00.000Z",
    );
    expect(later.ok).toBe(true);
    if (!later.ok) return;
    expect(later.value.strike).toBe(decimalString("13.60"));
    expect(later.value.adjustment).toBe("none");
  });

  it("an unrelated prior-year bonificação cannot claim a transition it could not have caused", () => {
    // 27.19@01-02, 24.72@01-05 (a step-3 early-dated epoch reflecting a future 10% bonus, F =
    // 1/1.1), plus an unrelated prior-year bonus ex 2023-01-20 — before this series listed — and
    // the real bonus ex 2024-01-08. As above, only the real, later factor may claim the
    // transition; the unrelated prior-year one is excluded from the start.
    const backfilled = series({
      asOf: "2024-01-05T21:00:00.000Z",
      strike: decimalString("24.72"),
    });
    const bonificacaoFactor = decimalString("0.909091");
    const unrelatedPriorBonus = factor({
      exDate: "2023-01-20",
      asOf: "2023-01-20T13:00:00.000Z",
      factor: bonificacaoFactor,
    });
    const realBonus = factor({
      exDate: "2024-01-08",
      asOf: "2024-01-08T13:00:00.000Z",
      factor: bonificacaoFactor,
    });
    const view: MarketView = {
      ...baseView,
      optionSeries: [series(), backfilled],
      corporateActions: [unrelatedPriorBonus, realBonus],
    };
    const atOpen = resolveOptionStrike(
      view,
      ticker,
      underlying,
      "2024-01-08",
      "2024-01-08T13:00:00.000Z",
    );
    expect(atOpen.ok).toBe(true);
    if (!atOpen.ok) return;
    expect(atOpen.value.strike).toBe(decimalString("24.72"));
    expect(atOpen.value.adjustment).toBe("none");

    const later = resolveOptionStrike(
      view,
      ticker,
      underlying,
      "2024-01-15",
      "2024-01-15T21:00:00.000Z",
    );
    expect(later.ok).toBe(true);
    if (!later.ok) return;
    expect(later.value.strike).toBe(decimalString("24.72"));
    expect(later.value.adjustment).toBe("none");
  });

  it("two optionSeries rows sharing an exact (ticker, asOf) chain the same way regardless of MarketView.optionSeries array order (I3)", () => {
    const a = series({ asOf: "2024-01-02T21:00:00.000Z", strike: decimalString("27.19") });
    const b = series({ asOf: "2024-01-05T21:00:00.000Z", strike: decimalString("13.60") });
    const c = series({ asOf: "2024-01-05T21:00:00.000Z", strike: decimalString("6.80") });
    const exFactor = factor({ exDate: "2024-01-19", asOf: "2024-01-19T13:00:00.000Z" });
    const atInstant = "2024-01-19T21:00:00.000Z";

    const forward: MarketView = {
      ...baseView,
      optionSeries: [a, b, c],
      corporateActions: [exFactor],
    };
    const shuffled: MarketView = {
      ...baseView,
      optionSeries: [a, c, b],
      corporateActions: [exFactor],
    };

    const fromForward = resolveOptionStrike(forward, ticker, underlying, "2024-01-19", atInstant);
    const fromShuffled = resolveOptionStrike(shuffled, ticker, underlying, "2024-01-19", atInstant);
    expect(fromForward.ok).toBe(true);
    expect(fromShuffled.ok).toBe(true);
    if (!fromForward.ok || !fromShuffled.ok) return;
    expect(fromShuffled.value.strike).toBe(fromForward.value.strike);
    expect(fromShuffled.value.adjustment).toBe(fromForward.value.adjustment);
  });

  it("B3's own rounding (BBASB310, ADR-0056): 29.95 x 0.5 -> 14.98 counts as reflected", () => {
    // 14.975 rounds half-up to 14.98 (the digit carries); an epoch dated before the ex-date it
    // reflects (01-04, like blocking 1 above) still needs the matching's own rounding to match
    // B3's exactly, or this would wrongly stay in the window and re-derive on top of it.
    const original = series({ strike: decimalString("29.95") });
    const earlyEpoch = series({ asOf: "2024-01-04T21:00:00.000Z", strike: decimalString("14.98") });
    const view: MarketView = {
      ...baseView,
      optionSeries: [original, earlyEpoch],
      corporateActions: [factor()],
    };
    const result = resolveOptionStrike(view, ticker, underlying, settlementSession, settlementAt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.strike).toBe(decimalString("14.98"));
    expect(result.value.adjustment).toBe("none");
  });

  it("caps the window at the series' own listed expiry: a factor ex-dated after expiry never rebases this leg's strike", () => {
    const expiringSeries = series({ expiry: "2024-01-05" });
    const view: MarketView = {
      ...baseView,
      optionSeries: [expiringSeries],
      corporateActions: [factor({ exDate: "2024-01-08", asOf: "2024-01-08T13:00:00.000Z" })],
    };
    const result = resolveOptionStrike(
      view,
      ticker,
      underlying,
      "2024-01-10",
      "2024-01-10T21:00:00.000Z",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.strike).toBe(decimalString("27.19"));
    expect(result.value.adjustment).toBe("none");
  });

  it("a factor ex-dated exactly on the series' own last session derives, stably, no matter how much later it is read", () => {
    // The series expires 01-05; a factor ex-dated exactly 01-05 can never get an epoch of its
    // own, since the series itself ceases to exist at that very session. Comparing against the
    // uncapped `atSession` (01-10) would read this as "unconfirmed" (exDate != atSession);
    // comparing against `through = min(atSession, expiry) = 01-05` reads it as "derived",
    // consistently, whether read at 01-05, 01-10 or any later instant.
    const expiringSeries = series({ expiry: "2024-01-05" });
    const onExpirySession = factor({ exDate: "2024-01-05", asOf: "2024-01-05T13:00:00.000Z" });
    const view: MarketView = {
      ...baseView,
      optionSeries: [expiringSeries],
      corporateActions: [onExpirySession],
    };
    const readAtExpiry = resolveOptionStrike(
      view,
      ticker,
      underlying,
      "2024-01-05",
      "2024-01-05T21:00:00.000Z",
    );
    expect(readAtExpiry.ok).toBe(true);
    if (!readAtExpiry.ok) return;
    expect(readAtExpiry.value.strike).toBe(decimalString("13.60"));
    expect(readAtExpiry.value.adjustment).toBe("derived");

    const readMuchLater = resolveOptionStrike(
      view,
      ticker,
      underlying,
      "2024-01-10",
      "2024-01-10T21:00:00.000Z",
    );
    expect(readMuchLater.ok).toBe(true);
    if (!readMuchLater.ok) return;
    expect(readMuchLater.value.strike).toBe(decimalString("13.60"));
    expect(readMuchLater.value.adjustment).toBe("derived");
  });

  it("a non-positive factor inside the window is invalid_input", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [series()],
      corporateActions: [factor({ factor: decimalString("0") })],
    };
    const result = resolveOptionStrike(view, ticker, underlying, settlementSession, settlementAt);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_input");
  });

  it("returns missing_instrument when no epoch is visible for the ticker at all", () => {
    const result = resolveOptionStrike(
      baseView,
      ticker,
      underlying,
      settlementSession,
      settlementAt,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("missing_instrument");
  });

  it("skips the window entirely when the caller has no calendar session to anchor `at` to (atSession null)", () => {
    const view: MarketView = {
      ...baseView,
      optionSeries: [series()],
      corporateActions: [factor()],
    };
    const result = resolveOptionStrike(view, ticker, underlying, null, settlementAt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.strike).toBe(decimalString("27.19"));
    expect(result.value.adjustment).toBe("none");
  });

  it("a factor exactly ex-dated on the epoch's own listed session is excluded by the window's own bound, not by the one-to-one match", () => {
    // A single epoch, already carrying the adjusted strike, dated exactly at the event it
    // reflects: the window's exclusive lower bound (`exDate > session(E.asOf)`) excludes the
    // factor outright, before the one-to-one match is ever consulted. This is not a transition
    // the matching drops — it is the window's own bound that never lets this factor into `W`.
    const adjusted = series({ asOf: "2024-01-08T21:00:00.000Z", strike: decimalString("14.98") });
    const view: MarketView = {
      ...baseView,
      optionSeries: [adjusted],
      corporateActions: [factor()],
    };
    const result = resolveOptionStrike(view, ticker, underlying, settlementSession, settlementAt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.strike).toBe(decimalString("14.98"));
    expect(result.value.adjustment).toBe("none");
  });

  it("a reused B3 ticker's older, unrelated cycle never joins the chain, even when its strike coincidentally matches a factor's own multiplier", () => {
    // The same ticker string reused for an elapsed, unrelated cycle (a different expiry) sits
    // between the current cycle's own two epochs by asOf alone. Its strike (13.60) coincides
    // with 27.19 x 0.5 purely by chance, which would wrongly let the real factor claim a
    // transition it never actually explains (the current cycle's second epoch, 26.00, is an
    // unrelated dividend re-strike) — reading "none" at 26.00 instead of "derived" at 13.00.
    const currentEpoch0 = series({
      asOf: "2024-01-02T21:00:00.000Z",
      strike: decimalString("27.19"),
    });
    const currentEpoch1 = series({
      asOf: "2024-01-05T21:00:00.000Z",
      strike: decimalString("26.00"),
    });
    const reusedTickerOlderCycle = series({
      asOf: "2024-01-04T12:00:00.000Z",
      expiry: "2023-06-16",
      strike: decimalString("13.60"),
    });
    const view: MarketView = {
      ...baseView,
      optionSeries: [currentEpoch0, reusedTickerOlderCycle, currentEpoch1],
      corporateActions: [factor({ exDate: "2024-01-08", asOf: "2024-01-08T13:00:00.000Z" })],
    };
    const result = resolveOptionStrike(
      view,
      ticker,
      underlying,
      "2024-01-08",
      "2024-01-08T13:00:00.000Z",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.strike).toBe(decimalString("13.00"));
    expect(result.value.adjustment).toBe("derived");
  });
});
