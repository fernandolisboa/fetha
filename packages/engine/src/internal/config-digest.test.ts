import { describe, expect, it } from "vitest";
import type { BacktestConfig } from "../api";
import { centavos, decimalString } from "../test/support";
import { configDigest } from "./config-digest";

const baseConfig: BacktestConfig = {
  strategy: {
    id: "v1",
    definition: {
      name: "test",
      timeframe: "D1",
      entry: {
        kind: "compare",
        left: { kind: "price", field: "close" },
        comparator: ">",
        right: { kind: "constant", value: decimalString("0") },
      },
      structureId: "stock",
      strikes: [],
      sizing: { kind: "fixed_fractional", fraction: decimalString("0.1") },
      exit: [],
      adjustments: [],
    },
    structure: {
      id: "stock",
      name: "Stock",
      expiry: "shared",
      legs: [{ role: "stock", side: "buy", ratio: 1 }],
    },
  },
  universe: ["PETR4"],
  period: { from: "2024-01-01", to: "2024-01-31" },
  initialCapital: centavos(100_000_00),
  costModel: {
    b3FeeRate: decimalString("0.0003"),
    brokerage: { stockPerOrder: centavos(0), optionPerContract: centavos(0) },
    optionSlippageRate: decimalString("0"),
    incomeTaxRate: decimalString("0.15"),
    monthlyStockSalesExemption: centavos(20_000_00),
  },
  riskProfile: {
    declaredCapital: centavos(100_000_00),
    limits: {
      maxLossPerOperation: decimalString("0.02"),
      maxExposurePerOperation: decimalString("0.1"),
      maxOpenOperations: 5,
      maxPremiumBought: decimalString("0.05"),
    },
  },
  limits: "enforce",
  sizing: null,
  walkForward: null,
  seed: 1,
};

describe("configDigest", () => {
  it("is stable for the same config", () => {
    expect(configDigest(baseConfig)).toBe(configDigest(baseConfig));
  });

  it("is order-independent over object key order", () => {
    const reordered: BacktestConfig = {
      ...baseConfig,
      riskProfile: {
        limits: { ...baseConfig.riskProfile.limits },
        declaredCapital: baseConfig.riskProfile.declaredCapital,
      },
    };
    expect(configDigest(reordered)).toBe(configDigest(baseConfig));
  });

  it("changes when the config changes", () => {
    const changed: BacktestConfig = { ...baseConfig, seed: 2 };
    expect(configDigest(changed)).not.toBe(configDigest(baseConfig));
  });

  it("sorts a nested object's keys in both directions regardless of insertion order", () => {
    const forward = {
      ...baseConfig,
      riskProfile: {
        ...baseConfig.riskProfile,
        limits: {
          maxLossPerOperation: decimalString("0.02"),
          maxExposurePerOperation: decimalString("0.1"),
          maxOpenOperations: 5,
          maxPremiumBought: decimalString("0.05"),
          zzz: decimalString("0"),
          aaa: decimalString("0"),
        },
      },
    } as unknown as BacktestConfig;
    const shuffled = {
      ...baseConfig,
      riskProfile: {
        ...baseConfig.riskProfile,
        limits: {
          aaa: decimalString("0"),
          zzz: decimalString("0"),
          maxPremiumBought: decimalString("0.05"),
          maxOpenOperations: 5,
          maxExposurePerOperation: decimalString("0.1"),
          maxLossPerOperation: decimalString("0.02"),
        },
      },
    } as unknown as BacktestConfig;
    expect(configDigest(forward)).toBe(configDigest(shuffled));
  });
});
