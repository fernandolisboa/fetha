import { describe, expect, it } from "vitest";
import type { Condition } from "@fetha/contracts";
import type { BacktestProgress, Operation, Result } from "../api";
import { evaluateStrategy } from "../internal/evaluate-strategy";
import { runBacktest } from "../internal/run-backtest";
import { smaCrossDown, smaCrossUp, syntheticBacktestInput } from "../test/backtest-fixture";
import { decimalString, quantity } from "../test/support";

// Golden outputs recorded from the per-session recomputing evaluator that predates #58's
// incremental one: any byte of drift in a run, a chunked run or a catch-up evaluation fails here.

const ema10 = { kind: "indicator", indicator: { kind: "ema", length: 10 } } as const;
const rsi14 = { kind: "indicator", indicator: { kind: "rsi", length: 14 } } as const;
const atr14 = { kind: "indicator", indicator: { kind: "atr", length: 14 } } as const;
const ivRank20 = {
  kind: "indicator",
  indicator: { kind: "iv_rank", lookbackSessions: 20 },
} as const;

const momentumEntry: Condition = {
  kind: "and",
  conditions: [
    { kind: "compare", left: { kind: "price", field: "close" }, comparator: ">", right: ema10 },
    {
      kind: "compare",
      left: rsi14,
      comparator: "<",
      right: { kind: "constant", value: decimalString("65") },
    },
    {
      kind: "compare",
      left: atr14,
      comparator: ">",
      right: { kind: "constant", value: decimalString("0.1") },
    },
  ],
};

const lowIvEntry: Condition = {
  kind: "compare",
  left: ivRank20,
  comparator: "<",
  right: { kind: "constant", value: decimalString("30") },
};

function complete(result: Result<BacktestProgress>) {
  if (!result.ok) throw new Error(`run failed: ${JSON.stringify(result.error)}`);
  if (result.value.status !== "complete") throw new Error("expected a complete run");
  return result.value.run;
}

function runInChunks(input: ReturnType<typeof syntheticBacktestInput>, step: number) {
  let result = runBacktest({ ...input, maxSessions: step });
  while (result.ok && result.value.status === "paused") {
    result = runBacktest({ ...input, maxSessions: step, resume: result.value.checkpoint });
  }
  return result;
}

describe("backtest golden outputs (#58)", () => {
  it("an SMA-cross run with corporate actions and all three exit rule kinds", async () => {
    const input = syntheticBacktestInput({
      sessions: 120,
      instruments: 6,
      corporateActions: true,
      exit: [
        { kind: "condition", condition: smaCrossDown },
        { kind: "stop_loss", multipleOfMaxLoss: decimalString("0.05") },
        { kind: "profit_target", fractionOfPremium: decimalString("0.08") },
      ],
    });
    const run = complete(runBacktest(input));
    await expect(JSON.stringify(run, null, 1)).toMatchFileSnapshot(
      "./__golden__/sma-cross-corporate-actions.json",
    );
    expect(runInChunks(input, 37)).toEqual(runBacktest(input));
  });

  it("an EMA/RSI/ATR run", async () => {
    const input = syntheticBacktestInput({
      sessions: 100,
      instruments: 5,
      corporateActions: true,
      entry: momentumEntry,
      exit: [{ kind: "condition", condition: { kind: "not", condition: momentumEntry } }],
    });
    await expect(JSON.stringify(complete(runBacktest(input)), null, 1)).toMatchFileSnapshot(
      "./__golden__/ema-rsi-atr.json",
    );
  });

  it("an IV-rank run whose index carries one point published after later sessions' points", async () => {
    const input = syntheticBacktestInput({
      sessions: 80,
      instruments: 3,
      impliedVolatility: "one_late_point",
      entry: lowIvEntry,
      exit: [{ kind: "condition", condition: { kind: "not", condition: lowIvEntry } }],
    });
    await expect(JSON.stringify(complete(runBacktest(input)), null, 1)).toMatchFileSnapshot(
      "./__golden__/iv-rank-late-point.json",
    );
  });

  it("a since..at catch-up evaluation holding one open operation", async () => {
    const { view, config } = syntheticBacktestInput({
      sessions: 60,
      instruments: 4,
      corporateActions: true,
      impliedVolatility: "in_order",
      entry: { kind: "and", conditions: [smaCrossUp, lowIvEntry] },
      exit: [
        { kind: "condition", condition: smaCrossDown },
        { kind: "stop_loss", multipleOfMaxLoss: decimalString("0.05") },
      ],
    });
    const from = view.calendar.find((s) => s.date === config.period.from);
    const to = view.calendar.at(-1);
    if (!from || !to) throw new Error("fixture calendar is empty");
    const held: Operation = {
      id: "held-1",
      underlying: "TCK003",
      legs: [
        {
          role: "stock",
          side: "buy",
          ticker: "TCK003",
          quantity: quantity(100),
          entryPrice: decimalString("30.00"),
        },
      ],
      expiry: null,
      openedAt: from.date,
      strategyVersionId: config.strategy.id,
      rolledFrom: null,
    };
    const evaluation = evaluateStrategy({
      view,
      strategy: config.strategy,
      instruments: config.universe,
      since: from.open,
      at: to.close,
      openOperations: [
        held,
        {
          ...held,
          id: "held-2",
          underlying: "TCK023",
          legs: held.legs.map((leg) => ({
            ...leg,
            ticker: "TCK023",
            entryPrice: decimalString("1000.00"),
          })),
        },
      ],
      riskProfile: config.riskProfile,
    });
    await expect(JSON.stringify(evaluation, null, 1)).toMatchFileSnapshot(
      "./__golden__/catch-up-evaluation.json",
    );
  });
});
