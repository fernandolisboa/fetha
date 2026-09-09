import { describe, expect, it } from "vitest";
import type { Centavos, RiskProfile } from "@fetha/contracts";
import type { MarketView } from "../api";
import { centavos, decimalString, quantity } from "../test/support";
import { priceStockLegs, type StockLegInput } from "./stock-pricing";

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

const provenanceBase = {
  engineVersion: "0.1.0",
  pricingModel: "bsm_continuous_yield" as const,
  dataVersion: null,
  datasetNotes: [],
};

const longLeg: StockLegInput[] = [
  {
    role: "stock",
    side: "buy",
    ticker: "PETR4",
    quantity: quantity(100),
    entryPrice: decimalString("25.00"),
    priceSource: "close",
  },
];

describe("priceStockLegs", () => {
  it("prices a single long stock leg with bounded max loss and unbounded max gain", () => {
    const pricing = priceStockLegs({
      at: "2024-01-10T20:00:00.000Z",
      underlying: "PETR4",
      spot: decimalString("25.00"),
      legs: longLeg,
      view: emptyView,
      provenanceBase,
    });
    expect(pricing.maxLoss).toBe(centavos(25_00 * 100));
    expect(pricing.maxGain).toBe("unbounded");
    expect(pricing.breakEvens).toEqual([decimalString("25.00")]);
    expect(pricing.netPremium).toBe(centavos(-25_00 * 100));
    expect(pricing.legs[0]?.priceSource).toBe("close");
    expect(pricing.notes).toContainEqual({
      code: "no_risk_profile",
      message: "no risk profile supplied; limits not checked",
    });
  });

  it("prices a single short stock leg with bounded max gain and unbounded max loss", () => {
    const pricing = priceStockLegs({
      at: "2024-01-10T20:00:00.000Z",
      underlying: "PETR4",
      spot: decimalString("25.00"),
      legs: [
        {
          role: "stock",
          side: "sell",
          ticker: "PETR4",
          quantity: quantity(100),
          entryPrice: decimalString("25.00"),
          priceSource: "close",
        },
      ],
      view: emptyView,
      provenanceBase,
    });
    expect(pricing.maxLoss).toBe("unbounded");
    expect(pricing.maxGain).toBe(centavos(25_00 * 100));
    expect(pricing.netPremium).toBe(centavos(25_00 * 100));
  });

  it("uses the explicit spot input rather than deriving it from a leg's entry price", () => {
    const pricing = priceStockLegs({
      at: "2024-01-10T20:00:00.000Z",
      underlying: "PETR4",
      spot: decimalString("30.00"),
      legs: longLeg,
      view: emptyView,
      provenanceBase,
    });
    expect(pricing.spot).toBe(decimalString("30.00"));
  });

  it("checks the maxLossPerOperation limit against declared capital", () => {
    const riskProfile: RiskProfile = {
      declaredCapital: centavos(10_000_00),
      limits: {
        maxLossPerOperation: decimalString("0.1"),
        maxExposurePerOperation: decimalString("1"),
        maxOpenOperations: 5,
        maxPremiumBought: decimalString("1"),
      },
    };
    const pricing = priceStockLegs({
      at: "2024-01-10T20:00:00.000Z",
      underlying: "PETR4",
      spot: decimalString("25.00"),
      legs: longLeg,
      view: emptyView,
      riskProfile,
      provenanceBase,
    });
    expect(pricing.limitBreaches).toEqual([
      {
        limit: "maxLossPerOperation",
        value: decimalString("0.250000"),
        allowed: decimalString("0.1"),
      },
    ]);
    expect(pricing.notes).toContainEqual({
      code: "limit_breach_warned",
      message: "the proposal breaches a risk-profile limit",
    });
  });

  it("does not breach limits when the operation stays under the risk profile", () => {
    const riskProfile: RiskProfile = {
      declaredCapital: centavos(100_000_00),
      limits: {
        maxLossPerOperation: decimalString("0.5"),
        maxExposurePerOperation: decimalString("1"),
        maxOpenOperations: 5,
        maxPremiumBought: decimalString("1"),
      },
    };
    const pricing = priceStockLegs({
      at: "2024-01-10T20:00:00.000Z",
      underlying: "PETR4",
      spot: decimalString("25.00"),
      legs: longLeg,
      view: emptyView,
      riskProfile,
      provenanceBase,
    });
    expect(pricing.limitBreaches).toEqual([]);
  });

  it("breaches maxPremiumBought when the structure is net debit beyond the limit", () => {
    const riskProfile: RiskProfile = {
      declaredCapital: centavos(10_000_00),
      limits: {
        maxLossPerOperation: decimalString("1"),
        maxExposurePerOperation: decimalString("1"),
        maxOpenOperations: 5,
        maxPremiumBought: decimalString("0.1"),
      },
    };
    const pricing = priceStockLegs({
      at: "2024-01-10T20:00:00.000Z",
      underlying: "PETR4",
      spot: decimalString("25.00"),
      legs: longLeg,
      view: emptyView,
      riskProfile,
      provenanceBase,
    });
    expect(pricing.limitBreaches).toContainEqual({
      limit: "maxPremiumBought",
      value: decimalString("0.250000"),
      allowed: decimalString("0.1"),
    });
  });

  it("does not check maxPremiumBought when the structure is net credit", () => {
    const riskProfile: RiskProfile = {
      declaredCapital: centavos(10_000_00),
      limits: {
        maxLossPerOperation: decimalString("1"),
        maxExposurePerOperation: decimalString("1"),
        maxOpenOperations: 5,
        maxPremiumBought: decimalString("0.0001"),
      },
    };
    const pricing = priceStockLegs({
      at: "2024-01-10T20:00:00.000Z",
      underlying: "PETR4",
      spot: decimalString("25.00"),
      legs: [
        {
          role: "stock",
          side: "sell",
          ticker: "PETR4",
          quantity: quantity(100),
          entryPrice: decimalString("25.00"),
          priceSource: "close",
        },
      ],
      view: emptyView,
      riskProfile,
      provenanceBase,
    });
    expect(pricing.limitBreaches.some((b) => b.limit === "maxPremiumBought")).toBe(false);
  });

  it("reads the latest visible CDI and dividend-yield points instead of defaulting to zero", () => {
    const view: MarketView = {
      ...emptyView,
      macro: [
        {
          series: "cdi",
          date: "2024-01-08",
          asOf: "2024-01-08T21:00:00.000Z",
          annualRate: decimalString("0.10"),
        },
        {
          series: "cdi",
          date: "2024-01-09",
          asOf: "2024-01-09T21:00:00.000Z",
          annualRate: decimalString("0.11"),
        },
      ],
      dividendYields: [
        {
          underlying: "PETR4",
          asOf: "2024-01-09T21:00:00.000Z",
          annualYield: decimalString("0.05"),
        },
      ],
    };
    const pricing = priceStockLegs({
      at: "2024-01-10T20:00:00.000Z",
      underlying: "PETR4",
      spot: decimalString("25.00"),
      legs: longLeg,
      view,
      provenanceBase,
    });
    expect(pricing.riskFreeRate).not.toBe(decimalString("0.000000"));
    expect(pricing.dividendYield).not.toBe(decimalString("0.000000"));
    expect(pricing.notes).not.toContainEqual(
      expect.objectContaining({ code: "dividend_yield_defaulted" }),
    );
  });

  it("skips the maxLossPerOperation check but still checks exposure when max loss is unbounded", () => {
    const riskProfile: RiskProfile = {
      declaredCapital: centavos(10_000_00),
      limits: {
        maxLossPerOperation: decimalString("0.1"),
        maxExposurePerOperation: decimalString("0.01"),
        maxOpenOperations: 5,
        maxPremiumBought: decimalString("1"),
      },
    };
    const pricing = priceStockLegs({
      at: "2024-01-10T20:00:00.000Z",
      underlying: "PETR4",
      spot: decimalString("25.00"),
      legs: [
        {
          role: "stock",
          side: "sell",
          ticker: "PETR4",
          quantity: quantity(100),
          entryPrice: decimalString("25.00"),
          priceSource: "close",
        },
      ],
      view: emptyView,
      riskProfile,
      provenanceBase,
    });
    expect(pricing.limitBreaches).toEqual([
      {
        limit: "maxExposurePerOperation",
        value: decimalString("0.250000"),
        allowed: decimalString("0.01"),
      },
    ]);
  });

  it("breaches maxOpenOperations when the count including this entry exceeds the limit", () => {
    const riskProfile: RiskProfile = {
      declaredCapital: centavos(100_000_00),
      limits: {
        maxLossPerOperation: decimalString("1"),
        maxExposurePerOperation: decimalString("1"),
        maxOpenOperations: 1,
        maxPremiumBought: decimalString("1"),
      },
    };
    const pricing = priceStockLegs({
      at: "2024-01-10T20:00:00.000Z",
      underlying: "PETR4",
      spot: decimalString("25.00"),
      legs: longLeg,
      view: emptyView,
      riskProfile,
      openOperationCount: 1,
      provenanceBase,
    });
    expect(pricing.limitBreaches).toEqual([
      {
        limit: "maxOpenOperations",
        value: decimalString("2.000000"),
        allowed: decimalString("1.000000"),
      },
    ]);
  });

  it("skips the capital-based checks when declared capital is not positive", () => {
    const riskProfile: RiskProfile = {
      declaredCapital: 0 as Centavos,
      limits: {
        maxLossPerOperation: decimalString("0.1"),
        maxExposurePerOperation: decimalString("0.1"),
        maxOpenOperations: 5,
        maxPremiumBought: decimalString("0.1"),
      },
    };
    const pricing = priceStockLegs({
      at: "2024-01-10T20:00:00.000Z",
      underlying: "PETR4",
      spot: decimalString("25.00"),
      legs: longLeg,
      view: emptyView,
      riskProfile,
      provenanceBase,
    });
    expect(pricing.limitBreaches).toEqual([]);
  });

  it("has zero max loss and max gain, and no break-evens, for a delta-neutral pair of legs", () => {
    const pricing = priceStockLegs({
      at: "2024-01-10T20:00:00.000Z",
      underlying: "PETR4",
      spot: decimalString("25.00"),
      legs: [
        {
          role: "stock",
          side: "buy",
          ticker: "PETR4",
          quantity: quantity(100),
          entryPrice: decimalString("25.00"),
          priceSource: "close",
        },
        {
          role: "stock",
          side: "sell",
          ticker: "PETR4",
          quantity: quantity(100),
          entryPrice: decimalString("25.00"),
          priceSource: "close",
        },
      ],
      view: emptyView,
      provenanceBase,
    });
    expect(pricing.maxLoss).toBe(centavos(0));
    expect(pricing.maxGain).toBe(centavos(0));
    expect(pricing.breakEvens).toEqual([]);
  });

  it("defaults the risk-free rate to zero without throwing when the visible cdi rate is at or below -1", () => {
    const view: MarketView = {
      ...emptyView,
      macro: [
        {
          series: "cdi",
          date: "2024-01-01",
          asOf: "2024-01-10T20:00:00.000Z",
          annualRate: decimalString("-1.00"),
        },
      ],
    };
    const pricing = priceStockLegs({
      at: "2024-01-10T20:00:00.000Z",
      underlying: "PETR4",
      spot: decimalString("25.00"),
      legs: longLeg,
      view,
      provenanceBase,
    });
    expect(pricing.riskFreeRate).toBe(decimalString("0.000000"));
    expect(pricing.notes).toContainEqual(
      expect.objectContaining({ code: "risk_free_rate_defaulted" }),
    );
  });

  it("defaults the dividend yield to zero without throwing when the visible yield is at or below -1", () => {
    const view: MarketView = {
      ...emptyView,
      dividendYields: [
        {
          underlying: "PETR4",
          asOf: "2024-01-10T20:00:00.000Z",
          annualYield: decimalString("-1.00"),
        },
      ],
    };
    const pricing = priceStockLegs({
      at: "2024-01-10T20:00:00.000Z",
      underlying: "PETR4",
      spot: decimalString("25.00"),
      legs: longLeg,
      view,
      provenanceBase,
    });
    expect(pricing.dividendYield).toBe(decimalString("0.000000"));
    expect(pricing.notes).toContainEqual(
      expect.objectContaining({ code: "dividend_yield_defaulted" }),
    );
  });
});
