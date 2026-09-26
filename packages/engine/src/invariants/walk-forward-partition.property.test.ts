import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { MarketView } from "../api";
import { runBacktest } from "../internal/run-backtest";
import { longBacktestFixtureArbitrary } from "./arbitraries";

// ADR-0014 Q37 and ADR-0023: walk-forward windows are consecutive, cover the whole period, and
// partition the run, so every operation, cost and tax is counted in exactly one window.
describe("Walk-forward partition", () => {
  it("windows tile the period and sum to the whole-run counts, costs and taxes", () => {
    fc.assert(
      fc.property(longBacktestFixtureArbitrary, (fixture) => {
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
        const result = runBacktest({ view, config: fixture.config });
        if (!result.ok || result.value.status !== "complete") {
          throw new Error("expected the run to complete");
        }
        const { run } = result.value;
        const windows = run.walkForward ?? [];

        expect(windows.map((w) => w.metrics.sessions).reduce((a, b) => a + b, 0)).toBe(
          run.metrics.sessions,
        );
        expect(windows[0]?.from).toBe(run.config.period.from);
        expect(windows.at(-1)?.to).toBe(run.config.period.to);
        const sum = (pick: (m: (typeof windows)[number]["metrics"]) => number): number =>
          windows.map((w) => pick(w.metrics)).reduce((a, b) => a + b, 0);
        expect(sum((m) => m.operations)).toBe(run.metrics.operations);
        expect(sum((m) => m.fees)).toBe(run.metrics.fees);
        expect(sum((m) => m.taxes)).toBe(run.metrics.taxes);
        expect(sum((m) => m.slippage)).toBe(run.metrics.slippage);
        for (const window of windows) {
          expect(Number(window.metrics.maxDrawdown)).toBeLessThanOrEqual(
            Number(run.metrics.maxDrawdown) + 1e-6,
          );
        }
      }),
      { numRuns: 8 },
    );
  }, 30_000);
});
