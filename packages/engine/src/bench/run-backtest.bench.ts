import { bench, describe } from "vitest";
import { runBacktest } from "../internal/run-backtest";
import { syntheticBacktestInput } from "../test/backtest-fixture";

// #58's acceptance benchmark: a 5-year daily run (1,250 sessions x 20 instruments, one entry and
// one exit rule), in one call and in the 50-session steps apps/web runs it in. Every iteration
// runs on a fresh copy of the input, so no view-keyed cache survives from the previous one; the
// copy itself is part of the timing.
const input = syntheticBacktestInput({ sessions: 1250, instruments: 20 });

function runInSteps(step: number): void {
  const fresh = structuredClone(input);
  let result = runBacktest({ ...fresh, maxSessions: step });
  while (result.ok && result.value.status === "paused") {
    result = runBacktest({ ...fresh, maxSessions: step, resume: result.value.checkpoint });
  }
}

describe("runBacktest, 1,250 sessions x 20 instruments", () => {
  bench(
    "one call",
    () => {
      runBacktest(structuredClone(input));
    },
    { iterations: 3, warmupIterations: 0 },
  );

  bench(
    "50-session steps",
    () => {
      runInSteps(50);
    },
    { iterations: 3, warmupIterations: 0 },
  );
});
