import Decimal from "decimal.js";
import type { Centavos, DecimalString } from "@fetha/contracts";
import type { BacktestMetrics, EquityPoint, Note } from "../api";
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

export function computeBacktestMetrics(input: MetricsInput): {
  metrics: BacktestMetrics;
  notes: Note[];
} {
  const notes: Note[] = [];
  const sessions = input.equityCurve.length;

  const equitySeries = [
    new Decimal(input.initialCapital),
    ...input.equityCurve.map((p) => new Decimal(p.equity)),
  ];
  const returns: Decimal[] = [];
  for (let i = 1; i < equitySeries.length; i += 1) {
    const prev = equitySeries[i - 1] as Decimal;
    const curr = equitySeries[i] as Decimal;
    returns.push(prev.isZero() ? new Decimal(0) : curr.div(prev).sub(1));
  }
  const excess = returns.map((r, i) => r.sub(new Decimal(input.rfPerSession[i] ?? "0")));
  const stdev = sampleStdev(excess);
  const sharpe =
    stdev !== null && !stdev.isZero()
      ? toDecimalString(
          mean(excess).div(stdev).mul(new Decimal(SESSIONS_PER_YEAR).sqrt()),
          RATIO_SCALE,
        )
      : null;

  const equityLast = new Decimal(
    sessions > 0
      ? assertDefined(
          input.equityCurve[sessions - 1],
          "computeBacktestMetrics: sessions counts the equity curve's own length",
        ).equity
      : input.initialCapital,
  );
  // A window's own starting equity (its baseline, `input.initialCapital` — the run's
  // initialCapital for the whole run, the previous window's ending equity for a walk-forward
  // window) can itself be non-positive, distinct from a non-positive *final* equity below:
  // every return in `returns` divides by the previous equity, so a non-positive baseline makes
  // the very first return undefined and corrupts the whole series sharpe is computed from, not
  // only the endpoint cagr reads. totalReturn stays `DecimalString` (never null, ADR-0013), so
  // it falls back to the same zero it already uses for an exactly-zero baseline.
  const nonPositiveBaseline = new Decimal(input.initialCapital).lte(0);
  const totalReturn = toDecimalString(
    nonPositiveBaseline ? new Decimal(0) : equityLast.div(input.initialCapital).sub(1),
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
  } else if (equityLast.lte(0)) {
    notes.push({
      code: "non_positive_equity",
      message: "final equity is non-positive; cagr has no real value",
    });
    sharpeFinal = sharpe;
  } else {
    const base = equityLast.div(input.initialCapital);
    cagr = toDecimalString(
      base.pow(new Decimal(SESSIONS_PER_YEAR).div(sessions)).sub(1),
      RATIO_SCALE,
    );
    sharpeFinal = sharpe;
  }

  const maxDrawdown = input.equityCurve.reduce(
    (acc, p) => Decimal.max(acc, new Decimal(p.drawdown)),
    new Decimal(0),
  );

  const heldCount = input.held.filter(Boolean).length;
  const exposure = sessions === 0 ? new Decimal(0) : new Decimal(heldCount).div(sessions);

  const wins = input.settledOperationPnls.filter((pnl) => pnl > 0);
  const losses = input.settledOperationPnls.filter((pnl) => pnl < 0);
  const winRate =
    input.settledOperationPnls.length === 0
      ? null
      : toDecimalString(
          new Decimal(wins.length).div(input.settledOperationPnls.length),
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
      operations: input.operationsCount,
      totalReturn,
      cagr,
      maxDrawdown: toDecimalString(maxDrawdown, RATIO_SCALE),
      sharpe: sharpeFinal,
      winRate,
      profitFactor,
      exposure: toDecimalString(exposure, RATIO_SCALE),
      fees: input.fees,
      taxes: input.taxes,
      slippage: input.slippage,
    },
    notes,
  };
}

export function sumCentavos(values: readonly Centavos[]): Centavos {
  return toCentavos(values.reduce((acc, v) => acc + v, 0));
}
