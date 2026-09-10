import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Condition, LegTemplate, Structure } from "@fetha/contracts";
import type {
  BacktestConfig,
  Candle,
  MarketView,
  MonthlyTax,
  StrategyVersion,
  TradingSession,
} from "../api";
import { runBacktest } from "../internal/run-backtest";
import { centavos, decimalString } from "../test/support";
import { BACKTEST_FIXTURE_SESSIONS, longBacktestFixtureArbitrary } from "./arbitraries";

const monthKeyOf = (date: string): string => date.slice(0, 7);

// Tax for month M is deducted on the last session of month M+1 (ADR-0013 "Taxes"); returns that
// due session's own date, or null when the calendar this fixture provides has no session in
// month M+1 at all (the tax accrued in the run's very last month).
function dueSessionForTaxMonth(month: string, calendar: readonly TradingSession[]): string | null {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const nextMonthKey =
    monthNumber === 12
      ? `${String(year + 1)}-01`
      : `${String(year)}-${String(monthNumber + 1).padStart(2, "0")}`;
  const sessionsOfNextMonth = calendar.filter((s) => monthKeyOf(s.date) === nextMonthKey);
  const last = sessionsOfNextMonth.at(-1);
  return last === undefined ? null : last.date;
}

// A short run's own final session forces the still-open month's tax to be computed and
// deducted right then (ADR-0013 "Taxes": "tax not yet deducted at period.to is deducted on the
// final session") — a real, deliberate difference from the full run, which does not reach that
// month's true due session by the cut. This sums exactly the tax entries a short run deducted
// early relative to what a full run would already owe by the same session.
function earlyTaxAtCut(
  taxes: readonly MonthlyTax[],
  cutSession: string,
  calendar: readonly TradingSession[],
): number {
  let total = 0;
  for (const t of taxes) {
    const due = dueSessionForTaxMonth(t.month, calendar);
    if (due === null || due > cutSession) total += t.tax;
  }
  return total;
}

describe("I7 Prefix-consistency", () => {
  it("a run stopped at session D agrees with the full run up to and including D", () => {
    fc.assert(
      fc.property(
        longBacktestFixtureArbitrary,
        fc.integer({ min: 1, max: BACKTEST_FIXTURE_SESSIONS - 2 }),
        (fixture, cutIndex) => {
          const view: MarketView = {
            calendar: fixture.calendar,
            candles: fixture.candles,
            corporateActions: [],
            optionSeries: [],
            optionPrices: [],
            quotes: [],
            macro: [
              {
                series: "cdi",
                date: fixture.calendar[0]?.date ?? "",
                asOf: fixture.calendar[0]?.open ?? "",
                annualRate: fixture.cdiAnnualRate,
              },
            ],
            dividendYields: [],
            impliedVolatilityIndex: [],
          };

          const cutSession = fixture.calendar[cutIndex];
          if (!cutSession) throw new Error("test setup: cutIndex within the calendar");

          const fullResult = runBacktest({ view, config: fixture.config });
          const shortResult = runBacktest({
            view,
            config: {
              ...fixture.config,
              period: { ...fixture.config.period, to: cutSession.date },
            },
          });
          expect(fullResult.ok).toBe(true);
          expect(shortResult.ok).toBe(true);
          if (!fullResult.ok || fullResult.value.status !== "complete") {
            throw new Error("expected the full run to complete");
          }
          if (!shortResult.ok || shortResult.value.status !== "complete") {
            throw new Error("expected the short run to complete");
          }

          const fullRun = fullResult.value.run;
          const shortRun = shortResult.value.run;

          // The short run's own final session is D — "tax not yet deducted at period.to is
          // deducted on the final session" (ADR-0013 "Taxes") forces the still-open month's tax
          // to be computed and paid right there, while the full run, for which D is not final,
          // has not yet reached that month's true due session. Every earlier point, and every
          // component of D's own equity besides that early tax, must still agree exactly.
          expect(shortRun.equityCurve.slice(0, cutIndex)).toEqual(
            fullRun.equityCurve.slice(0, cutIndex),
          );
          const shortAtCut = shortRun.equityCurve[cutIndex];
          const fullAtCut = fullRun.equityCurve[cutIndex];
          if (!shortAtCut || !fullAtCut) throw new Error("test setup: both curves reach cutIndex");
          const earlyTax = earlyTaxAtCut(shortRun.taxes, cutSession.date, fixture.calendar);
          expect(shortAtCut.cash).toBe(fullAtCut.cash - earlyTax);
          expect(shortAtCut.equity).toBe(fullAtCut.equity - earlyTax);
          const fillsUpToCut = fullRun.fills.filter((f) => f.session <= cutSession.date);
          expect(shortRun.fills).toEqual(fillsUpToCut);

          const fullOpsClosedByCut = fullRun.operations.filter(
            (op) => op.closedAt <= cutSession.date,
          );
          const shortOpsClosedBeforeCut = shortRun.operations.filter(
            (op) => op.status === "closed" && op.closeReason.kind !== "period_end",
          );
          expect(shortOpsClosedBeforeCut).toEqual(fullOpsClosedByCut);

          // Whatever is still open in the full run at the cut's close is closed with
          // period_end in the short run instead (no fill, no cost — same mark, same
          // equity), per ADR-0013's I7. "Still open at the cut" means the operation was
          // already opened by then, not merely closed at some later date — with an exit
          // rule and re-entry in play, a later operation the full run hasn't even opened
          // yet by the cut also has closedAt > cutSession.date and must not be counted.
          const stillOpenAtCutInFullRun = fullRun.operations.filter(
            (op) => op.openedAt <= cutSession.date && op.closedAt > cutSession.date,
          );
          const shortOpsAtPeriodEnd = shortRun.operations.filter(
            (op) => op.status === "closed" && op.closeReason.kind === "period_end",
          );
          expect(shortOpsAtPeriodEnd.map((op) => op.id).sort()).toEqual(
            stillOpenAtCutInFullRun.map((op) => op.id).sort(),
          );
        },
      ),
      { numRuns: 8 },
    );
  }, 30_000);

  it("agrees at a cut whose own month accrues a non-zero tax not yet due in the full run", () => {
    const session = (date: string): TradingSession => ({
      date,
      open: `${date}T13:00:00.000Z`,
      close: `${date}T20:00:00.000Z`,
    });
    const candle = (date: string, open: string, close: string): Candle => ({
      ticker: "PETR4",
      timeframe: "D1",
      session: date,
      asOf: `${date}T20:00:00.000Z`,
      open: decimalString(open),
      high: decimalString(close > open ? close : open),
      low: decimalString(close < open ? close : open),
      close: decimalString(close),
      tradedQuantity: 1000,
    });
    const closeAbove9: Condition = {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "constant", value: decimalString("9") },
    };
    const stockStructure: Structure = {
      id: "stock",
      name: "Stock",
      expiry: "shared",
      legs: [{ role: "stock", side: "buy", ratio: 1 }] as LegTemplate[],
    };
    const strategy: StrategyVersion = {
      id: "v1",
      definition: {
        name: "test",
        timeframe: "D1",
        structureId: "stock",
        strikes: [],
        sizing: { kind: "fixed_fractional", fraction: decimalString("0.5") },
        entry: closeAbove9,
        exit: [{ kind: "profit_target", fractionOfPremium: decimalString("0.15") }],
        adjustments: [],
      },
      structure: stockStructure,
    };
    const calendar = [
      "2024-01-02",
      "2024-01-03",
      "2024-01-04",
      "2024-01-05",
      "2024-02-01",
      "2024-02-02",
      "2024-03-01",
    ].map(session);
    const candles = [
      candle("2024-01-02", "10.00", "10.00"),
      candle("2024-01-03", "10.00", "10.00"),
      candle("2024-01-04", "11.00", "12.00"),
      candle("2024-01-05", "12.50", "12.50"),
      candle("2024-02-01", "5.00", "5.00"),
      candle("2024-02-02", "5.00", "5.00"),
      candle("2024-03-01", "5.00", "5.00"),
    ];
    const config: BacktestConfig = {
      strategy,
      universe: ["PETR4"],
      period: { from: "2024-01-02", to: "2024-03-01" },
      initialCapital: centavos(10_000_00),
      costModel: {
        b3FeeRate: decimalString("0.0005"),
        brokerage: { stockPerOrder: centavos(100), optionPerContract: centavos(0) },
        optionSlippageRate: decimalString("0"),
        incomeTaxRate: decimalString("0.15"),
        // Low enough that the profit-target exit closed on 2024-01-04 realizes a stock sale
        // past the exemption, so January accrues a non-zero tax — one the short run's own
        // final session (the cut, still inside January) forces it to compute and pay right
        // then, while the full run has not yet reached January's true due session
        // (2024-02-02), the deliberate difference this test exercises (ADR-0013 "Taxes").
        monthlyStockSalesExemption: centavos(100_00),
      },
      riskProfile: {
        declaredCapital: centavos(10_000_00),
        limits: {
          maxLossPerOperation: decimalString("1"),
          maxExposurePerOperation: decimalString("1"),
          maxOpenOperations: 5,
          maxPremiumBought: decimalString("1"),
        },
      },
      limits: "enforce",
      sizing: null,
      walkForward: null,
      seed: 1,
    };
    const view: MarketView = {
      calendar,
      candles,
      corporateActions: [],
      optionSeries: [],
      optionPrices: [],
      quotes: [],
      macro: [],
      dividendYields: [],
      impliedVolatilityIndex: [],
    };

    const cutIndex = 3;
    const cutSession = calendar[cutIndex];
    if (!cutSession) throw new Error("test setup: cutIndex within the calendar");

    const fullResult = runBacktest({ view, config });
    const shortResult = runBacktest({
      view,
      config: { ...config, period: { ...config.period, to: cutSession.date } },
    });
    expect(fullResult.ok).toBe(true);
    expect(shortResult.ok).toBe(true);
    if (!fullResult.ok || fullResult.value.status !== "complete") {
      throw new Error("expected the full run to complete");
    }
    if (!shortResult.ok || shortResult.value.status !== "complete") {
      throw new Error("expected the short run to complete");
    }

    const fullRun = fullResult.value.run;
    const shortRun = shortResult.value.run;
    const earlyTax = earlyTaxAtCut(shortRun.taxes, cutSession.date, calendar);
    expect(earlyTax).toBeGreaterThan(0);

    const shortAtCut = shortRun.equityCurve[cutIndex];
    const fullAtCut = fullRun.equityCurve[cutIndex];
    if (!shortAtCut || !fullAtCut) throw new Error("test setup: both curves reach cutIndex");
    expect(shortAtCut.cash).toBe(fullAtCut.cash - earlyTax);
    expect(shortAtCut.equity).toBe(fullAtCut.equity - earlyTax);
  });
});
