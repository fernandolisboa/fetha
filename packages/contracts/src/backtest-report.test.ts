import { describe, expect, it } from "vitest";

import { backtestCheckpointSchema, backtestRunSchema } from "./backtest-report";

function centavos(value: number) {
  return value;
}

describe("backtestCheckpointSchema", () => {
  it("parses the engine's checkpoint envelope without touching the opaque state", () => {
    const checkpoint = {
      schema: 1,
      engineVersion: "0.2.0",
      configDigest: "abc123",
      cursor: "2024-03-04",
      state: { anything: "the engine alone interprets" },
    };
    expect(backtestCheckpointSchema.parse(checkpoint)).toEqual(checkpoint);
  });

  it("rejects a checkpoint missing configDigest", () => {
    const invalid = { schema: 1, engineVersion: "0.2.0", cursor: "2024-03-04", state: null };
    expect(() => backtestCheckpointSchema.parse(invalid)).toThrow();
  });
});

describe("backtestRunSchema", () => {
  const run = {
    config: {
      strategy: {
        id: "v1",
        definition: {
          name: "Long PETR4 above 10",
          timeframe: "D1",
          structureId: "stock",
          entry: {
            kind: "compare",
            left: { kind: "price", field: "close" },
            comparator: ">",
            right: { kind: "constant", value: "10" },
          },
          strikes: [],
          sizing: { kind: "fixed_fractional", fraction: "0.1" },
          exit: [],
          adjustments: [],
        },
        structure: {
          id: "stock",
          name: "Long stock",
          expiry: "shared",
          legs: [{ role: "stock", side: "buy", ratio: 1 }],
        },
      },
      universe: ["PETR4"],
      period: { from: "2024-01-02", to: "2024-02-01" },
      initialCapital: centavos(100_000_00),
      costModel: {
        b3FeeRate: "0.0005",
        brokerage: { stockPerOrder: centavos(0), optionPerContract: centavos(99) },
        optionSlippageRate: "0.001",
        incomeTaxRate: "0.15",
        monthlyStockSalesExemption: centavos(20_000_00),
      },
      riskProfile: {
        declaredCapital: centavos(100_000_00),
        limits: {
          maxLossPerOperation: "1",
          maxExposurePerOperation: "1",
          maxOpenOperations: 50,
          maxPremiumBought: "1",
        },
      },
      limits: "enforce",
      sizing: null,
      walkForward: null,
      seed: 1,
    },
    configDigest: "digest",
    operations: [
      {
        id: "op1",
        underlying: "PETR4",
        legs: [{ role: "stock", side: "buy", ticker: "PETR4", quantity: 100, entryPrice: "30" }],
        expiry: null,
        openedAt: "2024-01-03",
        strategyVersionId: "v1",
        rolledFrom: null,
        pnl: centavos(500_00),
        maxLoss: centavos(3_000_00),
        status: "closed",
        closedAt: "2024-01-10",
        closeReason: { kind: "period_end" },
      },
    ],
    fills: [
      {
        ticker: "PETR4",
        side: "buy",
        quantity: 100,
        price: "30",
        session: "2024-01-03",
        at: "2024-01-03T13:00:00.000Z",
        costs: centavos(5_00),
        operationId: "op1",
        source: "next_session_open",
      },
    ],
    missedEntries: [],
    limitBreaches: [],
    equityCurve: [
      {
        session: "2024-01-03",
        equity: centavos(100_500_00),
        cash: centavos(70_000_00),
        drawdown: "0",
      },
    ],
    metrics: {
      sessions: 20,
      operations: 1,
      totalReturn: "0.005",
      cagr: null,
      maxDrawdown: "0.01",
      sharpe: null,
      winRate: "1",
      profitFactor: null,
      exposure: "0.3",
      fees: centavos(5_00),
      taxes: centavos(0),
      slippage: centavos(0),
    },
    walkForward: null,
    taxes: [],
    notes: [],
    provenance: {
      engineVersion: "0.2.0",
      pricingModel: "bsm_continuous_yield",
      truncated: [],
      dataVersion: null,
      datasetNotes: [],
    },
  };

  it("round-trips a representative engine BacktestRun report", () => {
    expect(backtestRunSchema.parse(run)).toEqual(run);
  });

  it("rejects an operation with an unknown status", () => {
    const broken = {
      ...run,
      operations: [{ ...run.operations[0], status: "open" }],
    };
    expect(() => backtestRunSchema.parse(broken)).toThrow();
  });
});
