import Decimal from "decimal.js";
import type { Centavos, DecimalString } from "@fetha/contracts";
import type { BacktestMetrics, EquityPoint, Note, SimulatedOperation } from "../api";
import { RATIO_SCALE, toDecimalString } from "./decimal";
import { assertDefined } from "./invariant";
import { toCentavos } from "./scalars";

export const MIN_ANNUALIZED_SESSIONS = 126;
const SESSIONS_PER_YEAR = 252;

export type MetricsInput = {
  equityCurve: readonly EquityPoint[];
  initialCapital: Centavos;
  rfPerSession: readonly DecimalString[];
  held: readonly boolean[];
  // A session is observed when it carries at least one universe candle and falls on or after the
  // strategy's first tradable session (ADR-0041). `sessions`, `sharpe`, `exposure` and the
  // MIN_ANNUALIZED_SESSIONS threshold are computed over this subsequence: a candle-less session
  // never happened as far as the strategy could tell, and neither did a warm-up one.
  observed: readonly boolean[];
  // True from the strategy's first tradable session through period end, gaps included (ADR-0041):
  // calendar time — and cash movement, e.g. a month-end tax deduction — is real across a
  // candle-less gap even though the strategy could not observe it, so `cagr`'s exponent,
  // `maxDrawdown` and `totalReturn` read this longer span instead of `observed`. Warm-up itself
  // stays excluded from both: capital sitting in cash before the strategy could ever trade is not
  // elapsed track record.
  postWarmup: readonly boolean[];
  settledOperationPnls: readonly Centavos[];
  operationsCount: number;
  fees: Centavos;
  taxes: Centavos;
  slippage: Centavos;
};

// Only called where a length check already guards against division by zero (sampleStdev's own
// length >= 2 guard, and the sharpe ternary that only evaluates this once stdev is non-null).
function mean(values: readonly Decimal[]): Decimal {
  return values.reduce((acc, v) => acc.add(v), new Decimal(0)).div(values.length);
}

function sampleStdev(values: readonly Decimal[]): Decimal | null {
  if (values.length < 2) return null;
  const m = mean(values);
  const variance = values
    .reduce((acc, v) => acc.add(v.sub(m).pow(2)), new Decimal(0))
    .div(values.length - 1);
  return variance.sqrt();
}

// The risk-free comparison for an observed session's own return must cover the same span the
// return itself does: a return computed against the previous *observed* equity point implicitly
// spans every unobserved (gap or warm-up) session in between, so the per-session rf of those
// dropped sessions is compounded forward into the next observed session's own rf here, rather than
// compared only against that session's single day's rate (ADR-0041). Compounding starts at the
// first post-warm-up session: equity sits flat at the baseline through warm-up, so the first
// observed return spans only the sessions from there on, and warm-up's own rf would otherwise land
// as one large negative excess return in a span ADR-0041 excludes from track record.
function compoundedRfForObserved(
  rfPerSession: readonly DecimalString[],
  observed: readonly boolean[],
  postWarmup: readonly boolean[],
): Decimal[] {
  const result: Decimal[] = [];
  let compounded = new Decimal(1);
  for (let i = 0; i < rfPerSession.length; i += 1) {
    if (!(postWarmup[i] ?? false)) continue;
    const rf = new Decimal(rfPerSession[i] ?? "0");
    compounded = compounded.mul(new Decimal(1).add(rf));
    if (observed[i] ?? false) {
      result.push(compounded.sub(1));
      compounded = new Decimal(1);
    }
  }
  return result;
}

function computeCagr(
  equityLast: Decimal,
  initialCapital: Centavos,
  elapsedSessions: number,
): DecimalString {
  const base = equityLast.div(initialCapital);
  return toDecimalString(
    base.pow(new Decimal(SESSIONS_PER_YEAR).div(elapsedSessions)).sub(1),
    RATIO_SCALE,
  );
}

export function computeBacktestMetrics(rawInput: MetricsInput): {
  metrics: BacktestMetrics;
  notes: Note[];
} {
  const notes: Note[] = [];

  const obsIndices: number[] = [];
  const pwIndices: number[] = [];
  rawInput.equityCurve.forEach((_point, i) => {
    if (rawInput.observed[i] ?? false) obsIndices.push(i);
    if (rawInput.postWarmup[i] ?? false) pwIndices.push(i);
  });
  const obsEquity = obsIndices.map((i) =>
    assertDefined(rawInput.equityCurve[i], "computeBacktestMetrics: index within bounds"),
  );
  const obsHeld = obsIndices.map((i) =>
    assertDefined(rawInput.held[i], "computeBacktestMetrics: index within bounds"),
  );
  const pwEquity = pwIndices.map((i) =>
    assertDefined(rawInput.equityCurve[i], "computeBacktestMetrics: index within bounds"),
  );

  const sessions = obsEquity.length;
  const elapsedSessions = pwEquity.length;

  // Sharpe: a path statistic over the observed subsequence only.
  const obsCompoundedRf = compoundedRfForObserved(
    rawInput.rfPerSession,
    rawInput.observed,
    rawInput.postWarmup,
  );
  const obsEquitySeries = [
    new Decimal(rawInput.initialCapital),
    ...obsEquity.map((p) => new Decimal(p.equity)),
  ];
  const obsReturns: Decimal[] = [];
  for (let i = 1; i < obsEquitySeries.length; i += 1) {
    const prev = assertDefined(
      obsEquitySeries[i - 1],
      "computeBacktestMetrics: index within bounds",
    );
    const curr = assertDefined(obsEquitySeries[i], "computeBacktestMetrics: index within bounds");
    obsReturns.push(prev.isZero() ? new Decimal(0) : curr.div(prev).sub(1));
  }
  const excess = obsReturns.map((r, i) =>
    r.sub(assertDefined(obsCompoundedRf[i], "computeBacktestMetrics: index within bounds")),
  );
  const stdev = sampleStdev(excess);
  const sharpe =
    stdev !== null && !stdev.isZero()
      ? toDecimalString(
          mean(excess).div(stdev).mul(new Decimal(SESSIONS_PER_YEAR).sqrt()),
          RATIO_SCALE,
        )
      : null;
  const anyNonPositiveEquityObs = obsEquitySeries.some((e) => e.lte(0));

  // cagr, totalReturn and maxDrawdown: the post-warm-up subsequence, gaps included — its own
  // final point is always the run's true final equity, since warm-up is only ever a leading
  // exclusion.
  const equityLast = new Decimal(
    elapsedSessions > 0
      ? assertDefined(pwEquity[elapsedSessions - 1], "computeBacktestMetrics: index within bounds")
          .equity
      : rawInput.initialCapital,
  );
  // A window's own starting equity (its baseline, `input.initialCapital` — the run's
  // initialCapital for the whole run, the previous window's ending equity for a walk-forward
  // window) can itself be non-positive, distinct from a non-positive *final* equity below: it
  // corrupts every return in both domains, since each divides by the previous equity starting
  // from this same baseline.
  const nonPositiveBaseline = new Decimal(rawInput.initialCapital).lte(0);
  const totalReturn = toDecimalString(
    nonPositiveBaseline ? new Decimal(0) : equityLast.div(rawInput.initialCapital).sub(1),
    RATIO_SCALE,
  );

  let cagr: DecimalString | null = null;
  let sharpeFinal: DecimalString | null = null;
  const annualized = sessions >= MIN_ANNUALIZED_SESSIONS;
  if (!annualized) {
    notes.push({
      code: "short_window_not_annualized",
      message: `fewer than ${String(MIN_ANNUALIZED_SESSIONS)} sessions; cagr and sharpe are not annualized`,
    });
  } else if (nonPositiveBaseline) {
    notes.push({
      code: "non_positive_equity",
      message: "the window's own starting equity is non-positive; every return in it is undefined",
    });
  } else {
    // cagr's own domain (post-warm-up, gaps included) only cares about its two endpoints, so an
    // interior non-positive point — possible in either domain — never affects it, independent of
    // sharpe below: only a non-positive *final* equity nulls cagr.
    if (equityLast.lte(0)) {
      notes.push({
        code: "non_positive_equity",
        message: "final equity is non-positive; cagr has no real value",
      });
    } else {
      cagr = computeCagr(equityLast, rawInput.initialCapital, elapsedSessions);
    }

    // sharpe's own domain (observed only): a path statistic, so any non-positive point anywhere
    // in it corrupts it, independent of cagr's endpoints-only check above.
    if (anyNonPositiveEquityObs) {
      notes.push({
        code: "non_positive_equity",
        message: "an equity point inside the window is non-positive; sharpe is undefined",
      });
    } else {
      sharpeFinal = sharpe;
    }
  }

  const maxDrawdown = pwEquity.reduce(
    (acc, p) => Decimal.max(acc, new Decimal(p.drawdown)),
    new Decimal(0),
  );

  const heldCount = obsHeld.filter(Boolean).length;
  const exposure = sessions === 0 ? new Decimal(0) : new Decimal(heldCount).div(sessions);

  const wins = rawInput.settledOperationPnls.filter((pnl) => pnl > 0);
  const losses = rawInput.settledOperationPnls.filter((pnl) => pnl < 0);
  const winRate =
    rawInput.settledOperationPnls.length === 0
      ? null
      : toDecimalString(
          new Decimal(wins.length).div(rawInput.settledOperationPnls.length),
          RATIO_SCALE,
        );
  const grossLosses = losses.reduce((acc, pnl) => acc.add(Math.abs(pnl)), new Decimal(0));
  const grossWins = wins.reduce((acc, pnl) => acc.add(pnl), new Decimal(0));
  const profitFactor = grossLosses.isZero()
    ? null
    : toDecimalString(grossWins.div(grossLosses), RATIO_SCALE);

  return {
    metrics: {
      sessions,
      operations: rawInput.operationsCount,
      totalReturn,
      cagr,
      maxDrawdown: toDecimalString(maxDrawdown, RATIO_SCALE),
      sharpe: sharpeFinal,
      winRate,
      profitFactor,
      exposure: toDecimalString(exposure, RATIO_SCALE),
      fees: rawInput.fees,
      taxes: rawInput.taxes,
      slippage: rawInput.slippage,
    },
    notes,
  };
}

export function sumCentavos(values: readonly Centavos[]): Centavos {
  return toCentavos(values.reduce((acc, v) => acc + v, 0));
}

// A settled operation is one whose pnl is a result, not a mark: closed by an exit rule or a
// roll, or expired, but not closed by period_end (that pnl is a valuation, ADR-0013 "Equity and
// metrics"). winRate and profitFactor are computed over settled operations only: an operation
// closed at period_end, and an expired operation whose residual was only marked (not traded) at
// period_end, are both a valuation rather than a result and are excluded the same way.
export function isSettledOperation(op: SimulatedOperation): boolean {
  if (op.status === "expired") return op.residualSettledBy !== "period_end";
  return op.closeReason.kind !== "period_end";
}
