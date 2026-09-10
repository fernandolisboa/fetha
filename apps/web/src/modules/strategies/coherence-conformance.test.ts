import { describe, expect, it } from "vitest";
import {
  checkStrategyCoherence,
  decimalStringSchema,
  type LegTemplate,
  type StrategyDefinition,
  type Structure,
} from "@fetha/contracts";
import { engine, type EvaluateStrategyInput, type MarketView } from "@fetha/engine";

// ADR-0013 "StrategyVersion coherence": `checkStrategyCoherence` (contracts)
// and `validateCoherence` (engine, internal) are two independent
// implementations of the same rule set because the engine imports contracts
// as types only and contracts cannot depend on the engine. This test is what
// keeps them honest: every rule, one passing and one failing fixture, run
// through both implementations, must agree.

const decimalString = (value: string) => decimalStringSchema.parse(value);

const emptyView: MarketView = {
  calendar: [],
  candles: [],
  corporateActions: [],
  optionSeries: [],
  optionPrices: [],
  quotes: [],
  macro: [],
  dividendYields: [],
  impliedVolatilityIndex: [],
};

const stockStructure: Structure = {
  id: "stock",
  name: "Stock",
  expiry: "shared",
  legs: [{ role: "stock", side: "buy", ratio: 1 }] as LegTemplate[],
};

const optionStructure: Structure = {
  id: "covered_call",
  name: "Covered call",
  expiry: "shared",
  legs: [
    { role: "stock", side: "buy", ratio: 1 },
    { role: "call", side: "sell", ratio: 1, strikeRank: 1 },
  ] as LegTemplate[],
};

const baseDefinition = (overrides: Partial<StrategyDefinition> = {}): StrategyDefinition => ({
  name: "test",
  timeframe: "D1",
  structureId: "stock",
  strikes: [],
  entry: {
    kind: "compare",
    left: { kind: "price", field: "close" },
    comparator: ">",
    right: { kind: "constant", value: decimalString("0") },
  },
  sizing: { kind: "fixed_fractional", fraction: decimalString("0.5") },
  exit: [],
  adjustments: [],
  ...overrides,
});

type Fixture = { name: string; definition: StrategyDefinition; structure: Structure };

const fixtures: Fixture[] = [
  {
    name: "coherent stock-only definition",
    definition: baseDefinition(),
    structure: stockStructure,
  },
  {
    name: "mismatched structureId",
    definition: baseDefinition({ structureId: "other" }),
    structure: stockStructure,
  },
  {
    name: "stock-only definition with strikes",
    definition: baseDefinition({ strikes: [{ kind: "moneyness", percent: decimalString("0") }] }),
    structure: stockStructure,
  },
  {
    name: "stock-only definition with an expiry selection",
    definition: baseDefinition({ expiry: { kind: "business_days", min: 5, max: 10 } }),
    structure: stockStructure,
  },
  {
    name: "stock-only definition with a days_before_expiry exit rule",
    definition: baseDefinition({ exit: [{ kind: "days_before_expiry", businessDays: 3 }] }),
    structure: stockStructure,
  },
  {
    name: "stock-only definition with a roll adjustment",
    definition: baseDefinition({
      adjustments: [
        {
          kind: "roll",
          when: { kind: "days_before_expiry", businessDays: 3 },
          expiry: { kind: "business_days", min: 5, max: 10 },
          strikes: [{ kind: "moneyness", percent: decimalString("0") }],
        },
      ],
    }),
    structure: stockStructure,
  },
  {
    name: "coherent option-legged definition",
    definition: baseDefinition({
      structureId: "covered_call",
      strikes: [{ kind: "moneyness", percent: decimalString("0") }],
      expiry: { kind: "business_days", min: 5, max: 10 },
    }),
    structure: optionStructure,
  },
  {
    name: "option-legged definition with no expiry selection",
    definition: baseDefinition({
      structureId: "covered_call",
      strikes: [{ kind: "moneyness", percent: decimalString("0") }],
    }),
    structure: optionStructure,
  },
  {
    name: "option-legged definition whose strikes.length does not match distinct ranks",
    definition: baseDefinition({
      structureId: "covered_call",
      strikes: [],
      expiry: { kind: "business_days", min: 5, max: 10 },
    }),
    structure: optionStructure,
  },
];

describe("coherence conformance: contracts vs engine", () => {
  it.each(fixtures)("$name: contracts and engine agree", async ({ definition, structure }) => {
    const contractsResult = checkStrategyCoherence(definition, structure);

    const input: EvaluateStrategyInput = {
      view: emptyView,
      strategy: { id: "v1", definition, structure },
      instruments: ["PETR4"],
      at: "2024-01-04T21:00:00.000Z",
    };
    const engineResult = await engine.evaluateStrategy(input);
    const coherenceError =
      !engineResult.ok &&
      engineResult.error.code === "invalid_input" &&
      engineResult.error.path.startsWith("strategy.definition.")
        ? engineResult.error
        : null;

    if (contractsResult.ok) {
      expect(coherenceError).toBeNull();
    } else {
      expect(coherenceError).not.toBeNull();
      expect(coherenceError?.path).toBe(`strategy.definition.${contractsResult.path}`);
      expect(coherenceError?.message).toBe(contractsResult.message);
    }
  });
});
