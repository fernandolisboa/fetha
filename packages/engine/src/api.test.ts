import { describe, expect, expectTypeOf, it } from "vitest";
import { ENGINE_VERSION, type Engine, type MarketView } from "./api";

type EngineMethod = keyof Engine;

describe("engine public interface", () => {
  it("declares a semantic version", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exposes exactly the ten frozen methods", () => {
    expectTypeOf<EngineMethod>().toEqualTypeOf<
      | "capabilities"
      | "dataWindow"
      | "indicators"
      | "priceOperation"
      | "evaluateStrategy"
      | "runBacktest"
      | "markToMarket"
      | "proposeSettlement"
      | "score"
      | "impliedVolatilityIndex"
    >();
  });

  it("keeps capabilities and dataWindow synchronous and every computation async", () => {
    expectTypeOf<ReturnType<Engine["capabilities"]>>().not.toEqualTypeOf<Promise<unknown>>();
    expectTypeOf<ReturnType<Engine["dataWindow"]>>().not.toEqualTypeOf<Promise<unknown>>();
    expectTypeOf<ReturnType<Engine["priceOperation"]>>().toExtend<Promise<unknown>>();
    expectTypeOf<ReturnType<Engine["runBacktest"]>>().toExtend<Promise<unknown>>();
  });

  it("carries asOf on every market view row type", () => {
    expectTypeOf<MarketView["candles"][number]>().toHaveProperty("asOf");
    expectTypeOf<MarketView["optionSeries"][number]>().toHaveProperty("asOf");
    expectTypeOf<MarketView["optionPrices"][number]>().toHaveProperty("asOf");
    expectTypeOf<MarketView["quotes"][number]>().toHaveProperty("asOf");
    expectTypeOf<MarketView["macro"][number]>().toHaveProperty("asOf");
    expectTypeOf<MarketView["dividendYields"][number]>().toHaveProperty("asOf");
    expectTypeOf<MarketView["impliedVolatilityIndex"][number]>().toHaveProperty("asOf");
  });
});
