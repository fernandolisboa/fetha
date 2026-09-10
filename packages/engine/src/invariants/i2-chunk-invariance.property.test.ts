import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { MarketView, RunBacktestInput } from "../api";
import { runBacktest } from "../internal/run-backtest";
import { longBacktestFixtureArbitrary } from "./arbitraries";

describe("I2 Chunk-invariance", () => {
  it("any maxSessions split reproduces the same run as one uninterrupted call, sharpe included", () => {
    fc.assert(
      fc.property(
        longBacktestFixtureArbitrary,
        fc.integer({ min: 10, max: 60 }),
        (fixture, maxSessions) => {
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

          const whole = runBacktest({ view, config: fixture.config });
          expect(whole.ok).toBe(true);
          if (!whole.ok || whole.value.status !== "complete") {
            throw new Error("expected the uninterrupted run to complete");
          }

          let resume: RunBacktestInput["resume"] | undefined;
          let last: ReturnType<typeof runBacktest> | null = null;
          for (let iterations = 0; iterations < 20; iterations += 1) {
            const step = runBacktest(
              resume === undefined
                ? { view, config: fixture.config, maxSessions }
                : { view, config: fixture.config, maxSessions, resume },
            );
            expect(step.ok).toBe(true);
            if (!step.ok) throw new Error("expected an ok result");
            last = step;
            if (step.value.status === "complete") break;
            resume = step.value.checkpoint;
          }
          if (!last?.ok || last.value.status !== "complete") {
            throw new Error("expected the chunked run to complete");
          }

          // provenance.truncated depends on the view slice each chunk receives, not on the
          // uninterrupted call's own slice, so ADR-0013 (I2) compares the runs with it stripped.
          const stripTruncated = (run: (typeof whole.value)["run"]) => ({
            ...run,
            provenance: { ...run.provenance, truncated: [] },
          });
          expect(stripTruncated(last.value.run)).toEqual(stripTruncated(whole.value.run));
        },
      ),
      { numRuns: 8 },
    );
  }, 30_000);
});
