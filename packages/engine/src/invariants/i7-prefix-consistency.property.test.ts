import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { MarketView } from "../api";
import { runBacktest } from "../internal/run-backtest";
import { BACKTEST_FIXTURE_SESSIONS, longBacktestFixtureArbitrary } from "./arbitraries";

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

          expect(shortRun.equityCurve).toEqual(fullRun.equityCurve.slice(0, cutIndex + 1));
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
});
