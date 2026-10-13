import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  analysisInputsSchema,
  decimalStringSchema,
  MAX_CONDITION_DEPTH,
  type Condition,
  type CostModel,
  type DecimalString,
  type StrategyDefinition,
} from "@fetha/contracts";
import type {
  AssetReading,
  BacktestMetrics,
  IndicatorReading,
  OperationLeg,
  OperationPricing,
  Proposal,
  WalkForwardWindow,
} from "@fetha/engine";

import {
  backtestRunFacts,
  contemplatedOperationFacts,
  genericFact,
  heldOperationFacts,
  signalFacts,
  suggestionFacts,
  type BacktestRunFactsInput,
} from "./analysis-facts";

const fixtures = fileURLToPath(
  new URL("../../../../../prompts/fixtures/analysis/v1/", import.meta.url),
);

function readFixture(name: string): { subject: string; facts: Record<string, unknown> } {
  return JSON.parse(readFileSync(`${fixtures}${name}/inputs.json`, "utf8")) as {
    subject: string;
    facts: Record<string, unknown>;
  };
}

function keySet(value: Record<string, unknown>): Set<string> {
  return new Set(Object.keys(value));
}

const pricing = {
  at: "2026-10-09T18:00:00.000Z",
  underlying: "PETR4",
  spot: "31.20",
  riskFreeRate: "0.1065",
  dividendYield: "0",
  legs: [
    {
      leg: { role: "call", side: "buy", ticker: "PETRK310", quantity: 100 },
      price: "1.90",
      priceSource: "close",
      stale: null,
      fairValue: "1.85",
      impliedVolatility: "0.312",
      volatilitySource: "own_implied",
      greeks: { delta: "0.55", gamma: "0.12", theta: "-0.02", vega: "0.04", rho: "0.01" },
      timeToExpiryYears: "0.1",
      notes: [],
    },
  ],
  netPremium: -12000,
  greeks: { delta: "18.4", gamma: "2.1", theta: "-0.85", vega: "3.2", rho: "1.05" },
  payoff: [
    { underlying: "29.00", pnl: -12000 },
    { underlying: "32.20", pnl: 0 },
    { underlying: "33.00", pnl: 8000 },
  ],
  breakEvens: ["32.20"],
  maxLoss: -12000,
  maxGain: 8000,
  limitBreaches: [],
  notes: [{ code: "european_pricing", message: "European-style option, no early exercise" }],
  provenance: {
    engineVersion: "test",
    pricingModel: "bsm_continuous_yield",
    truncated: [],
    dataVersion: null,
    datasetNotes: [],
  },
} as unknown as OperationPricing;

const proposal: Proposal = {
  legs: pricing.legs.map((leg) => leg.leg),
  pricing,
};

const metrics = {
  sessions: 935,
  operations: 42,
  totalReturn: "0.184",
  cagr: "0.0462",
  maxDrawdown: "-0.213",
  sharpe: "0.38",
  winRate: "0.4286",
  profitFactor: "1.21",
  exposure: "0.385",
  fees: 124000,
  taxes: 231000,
  slippage: 0,
} as unknown as BacktestMetrics;

const walkForward = [
  { from: "2023-01-02", to: "2023-12-29", metrics },
  { from: "2024-01-02", to: "2024-12-30", metrics },
] as unknown as WalkForwardWindow[];

describe("genericFact", () => {
  it("converts decimal strings to pt-BR comma decimals", () => {
    expect(genericFact("8.00")).toBe("8,00");
    expect(genericFact("-0.85")).toBe("−0,85");
  });

  it("converts numbers to plain strings and booleans to sim/não", () => {
    expect(genericFact(20)).toBe("20");
    expect(genericFact(true)).toBe("sim");
    expect(genericFact(false)).toBe("não");
  });

  it("formats the sizing fraction as a percentage", () => {
    expect(genericFact({ kind: "fixed_fractional", fraction: "0.1" })).toEqual({
      kind: "fixed_fractional",
      fraction: "10%",
    });
  });

  it("drops undefined values instead of writing null", () => {
    expect(genericFact({ a: 1, b: undefined })).toEqual({ a: "1" });
  });
});

describe("signalFacts", () => {
  const facts = signalFacts({
    session: "2026-10-09",
    kind: "entry",
    ticker: "VALE3",
    timeframe: "D1",
    indicators: [
      { indicator: { kind: "sma", length: 20 }, value: "58.4" },
    ] as unknown as IndicatorReading[],
    rule: null,
    proposal,
  });

  it("validates against analysisInputsSchema", () => {
    expect(analysisInputsSchema.safeParse({ subject: "signal", facts }).success).toBe(true);
  });

  it("matches the fixture's top-level and pricing key sets", () => {
    const fixture = readFixture("signal-stock-entry");
    expect(keySet(facts)).toEqual(keySet(fixture.facts));
    const fixtureProposal = fixture.facts.proposal as { pricing: Record<string, unknown> };
    expect(keySet((facts.proposal as { pricing: Record<string, unknown> }).pricing)).toEqual(
      keySet(fixtureProposal.pricing),
    );
  });
});

describe("contemplatedOperationFacts", () => {
  const facts = contemplatedOperationFacts({
    session: "2026-10-09",
    structure: "Trava de alta com calls",
    underlying: "PETR4",
    pricing,
  });

  it("validates against analysisInputsSchema", () => {
    expect(
      analysisInputsSchema.safeParse({ subject: "contemplated_operation", facts }).success,
    ).toBe(true);
  });

  it("matches the fixture's top-level and pricing key sets", () => {
    const fixture = readFixture("contemplated-bull-call-spread");
    expect(keySet(facts)).toEqual(keySet(fixture.facts));
    expect(keySet(facts.pricing as Record<string, unknown>)).toEqual(
      keySet(fixture.facts.pricing as Record<string, unknown>),
    );
  });
});

describe("suggestionFacts", () => {
  const v3Fixture = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          "../../../../../prompts/fixtures/analysis/v3/suggestion-bull-call-spread/inputs.json",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  ) as { facts: Record<string, Record<string, unknown>> };
  const label = (value: string) => ({ label: value });
  const facts = suggestionFacts({
    session: "2026-10-09",
    expiry: "2026-11-20",
    underlying: "PETR4",
    structure: "Trava de alta com calls",
    recipe: {
      expectedMove: "up",
      ivRegime: "low",
      entry: { kind: "compare", comparator: "<", right: { kind: "constant", value: "70" } },
      exit: [{ kind: "profit_target", fractionOfPremium: "0.5" }],
    },
    reading: {
      trend: label("up"),
      momentum: label("neutral"),
      range: label("normal"),
      impliedVolatility: label("low"),
      options: label("liquid"),
    } as unknown as AssetReading,
    close: decimalStringSchema.parse("31.20"),
    indicators: [],
    pricing,
  });

  it("validates against analysisInputsSchema", () => {
    expect(analysisInputsSchema.safeParse({ subject: "suggestion", facts }).success).toBe(true);
  });

  it("matches the v3 fixture's key sets and writes the rule's numbers in pt-BR", () => {
    expect(keySet(facts)).toEqual(keySet(v3Fixture.facts));
    for (const key of ["recipe", "reading", "entry", "pricing"]) {
      expect(keySet(facts[key] as Record<string, unknown>)).toEqual(
        keySet(v3Fixture.facts[key] ?? {}),
      );
    }
    expect(facts.recipe).toMatchObject({ exit: [{ fractionOfPremium: "0,5" }] });
    expect(facts.entry).toMatchObject({ close: "R$ 31,20" });
  });

  it("carries no reading when the radar row has none", () => {
    expect(
      suggestionFacts({
        session: "2026-10-09",
        expiry: "2026-11-20",
        underlying: "PETR4",
        structure: "Trava de alta com calls",
        recipe: { expectedMove: "up", ivRegime: "low", entry: null, exit: [] },
        reading: null,
        close: decimalStringSchema.parse("31.20"),
        indicators: [],
        pricing,
      }).reading,
    ).toBeNull();
  });
});

describe("heldOperationFacts", () => {
  const facts = heldOperationFacts({
    session: "2026-10-09",
    underlying: "ITUB4",
    openedAt: "2026-09-02",
    expiry: "2026-11-20",
    legs: [
      { role: "stock", side: "buy", ticker: "ITUB4", quantity: 300, entryPrice: "34.50" },
    ] as unknown as OperationLeg[],
    pricing,
  });

  it("validates against analysisInputsSchema", () => {
    expect(analysisInputsSchema.safeParse({ subject: "held_operation", facts }).success).toBe(true);
  });

  it("matches the fixture's top-level and pricing key sets", () => {
    const fixture = readFixture("held-covered-call");
    expect(keySet(facts)).toEqual(keySet(fixture.facts));
    expect(keySet(facts.pricing as Record<string, unknown>)).toEqual(
      keySet(fixture.facts.pricing as Record<string, unknown>),
    );
  });
});

describe("backtestRunFacts", () => {
  const facts = backtestRunFacts({
    period: { from: "2023-01-02", to: "2026-09-30" },
    timeframe: "D1",
    universe: ["PETR4", "VALE3"],
    initialCapital: 10000000 as unknown as BacktestRunFactsInput["initialCapital"],
    costModel: {
      b3FeeRate: "0.0003",
      b3OptionFeeRate: "0.0004",
      brokerage: { stockPerOrder: 0, optionPerOrder: 0 },
      optionSlippageRate: "0.005",
      incomeTaxRate: "0.15",
      monthlyStockSalesExemption: 2000000,
    } as unknown as CostModel,
    strategy: {
      name: "Golden cross",
      timeframe: "D1",
      entry: {
        kind: "compare",
        left: { kind: "price", field: "close" },
        comparator: ">",
        right: { kind: "indicator", indicator: { kind: "sma", length: 50 } },
      },
      structureId: "stock_long",
      strikes: [],
      sizing: { kind: "fixed_fractional", fraction: "0.1" },
      exit: [{ kind: "stop_loss", multipleOfMaxLoss: "0.08" }],
      adjustments: [],
    } as unknown as StrategyDefinition,
    metrics,
    walkForward,
    counts: { operations: 42, missedEntries: 3, limitBreaches: 0 },
    notes: [],
  });

  it("validates against analysisInputsSchema", () => {
    expect(analysisInputsSchema.safeParse({ subject: "backtest_run", facts }).success).toBe(true);
  });

  it("matches the fixture's top-level and metrics key sets", () => {
    const fixture = readFixture("backtest-trend-following");
    expect(keySet(facts)).toEqual(keySet(fixture.facts));
    expect(keySet(facts.metrics as Record<string, unknown>)).toEqual(
      keySet(fixture.facts.metrics as Record<string, unknown>),
    );
  });

  it("never sends the strategy's name", () => {
    expect(JSON.stringify(facts.strategy)).not.toContain("Golden cross");
  });

  it("says no window was omitted when there are 12 or fewer", () => {
    expect(facts.walkForwardOmitted).toBe("nenhuma janela de walk-forward omitida");
  });
});

describe("backtestRunFacts walk-forward window cap", () => {
  const manyWindows = Array.from({ length: 15 }, (_, index) => {
    const year = 2010 + index;
    return {
      from: `${String(year)}-01-02`,
      to: `${String(year)}-12-29`,
      metrics,
    };
  }) as unknown as WalkForwardWindow[];

  const facts = backtestRunFacts({
    period: { from: "2023-01-02", to: "2026-09-30" },
    timeframe: "D1",
    universe: ["PETR4"],
    initialCapital: 10000000 as unknown as BacktestRunFactsInput["initialCapital"],
    costModel: {
      b3FeeRate: "0.0003",
      b3OptionFeeRate: "0.0004",
      brokerage: { stockPerOrder: 0, optionPerOrder: 0 },
      optionSlippageRate: "0.005",
      incomeTaxRate: "0.15",
      monthlyStockSalesExemption: 2000000,
    } as unknown as CostModel,
    strategy: {
      name: "Golden cross",
      timeframe: "D1",
      entry: {
        kind: "compare",
        left: { kind: "price", field: "close" },
        comparator: ">",
        right: { kind: "indicator", indicator: { kind: "sma", length: 50 } },
      },
      structureId: "stock_long",
      strikes: [],
      sizing: { kind: "fixed_fractional", fraction: "0.1" },
      exit: [{ kind: "stop_loss", multipleOfMaxLoss: "0.08" }],
      adjustments: [],
    } as unknown as StrategyDefinition,
    metrics,
    walkForward: manyWindows,
    counts: { operations: 42, missedEntries: 3, limitBreaches: 0 },
    notes: [],
  });

  it("keeps the 12 most recent windows, not the oldest 12", () => {
    const kept = facts.walkForward as readonly { from: string }[];
    expect(kept).toHaveLength(12);
    // The three oldest windows (2010-2012) are dropped; 2013 is the first
    // window kept.
    expect(kept[0]?.from).toBe("02/01/2013");
    expect(kept[kept.length - 1]?.from).toBe("02/01/2024");
  });

  it("states how many windows were left out", () => {
    expect(facts.walkForwardOmitted).toBe("3 janelas de walk-forward omitidas");
  });
});

function deepestCondition(): Condition {
  let condition: Condition = {
    kind: "compare",
    left: { kind: "price", field: "close" },
    comparator: ">",
    right: { kind: "constant", value: "1" as DecimalString },
  };
  for (let level = 1; level < MAX_CONDITION_DEPTH; level += 1) {
    condition = { kind: "and", conditions: [condition] };
  }
  return condition;
}

describe("backtestRunFacts at the deepest legal fact tree", () => {
  it("passes analysisInputsSchema for a strategy nesting a condition at MAX_CONDITION_DEPTH inside an exit rule and inside a roll adjustment's when", () => {
    const condition = deepestCondition();
    const strategy = {
      name: "Deep strategy",
      timeframe: "D1",
      entry: {
        kind: "compare",
        left: { kind: "price", field: "close" },
        comparator: ">",
        right: { kind: "constant", value: "1" },
      },
      structureId: "stock_long",
      strikes: [],
      sizing: { kind: "fixed_fractional", fraction: "0.1" },
      exit: [{ kind: "condition", condition }],
      adjustments: [
        {
          kind: "roll",
          when: { kind: "condition", condition },
          expiry: { kind: "business_days", min: 1, max: 5 },
          strikes: [{ kind: "nearest", price: "1" }],
        },
      ],
    } as unknown as StrategyDefinition;

    const facts = backtestRunFacts({
      period: { from: "2023-01-02", to: "2026-09-30" },
      timeframe: "D1",
      universe: ["PETR4"],
      initialCapital: 10000000 as unknown as BacktestRunFactsInput["initialCapital"],
      costModel: {
        b3FeeRate: "0.0003",
        b3OptionFeeRate: "0.0004",
        brokerage: { stockPerOrder: 0, optionPerOrder: 0 },
        optionSlippageRate: "0.005",
        incomeTaxRate: "0.15",
        monthlyStockSalesExemption: 2000000,
      } as unknown as CostModel,
      strategy,
      metrics,
      walkForward: [],
      counts: { operations: 1, missedEntries: 0, limitBreaches: 0 },
      notes: [],
    });

    expect(analysisInputsSchema.safeParse({ subject: "backtest_run", facts }).success).toBe(true);
  });
});
