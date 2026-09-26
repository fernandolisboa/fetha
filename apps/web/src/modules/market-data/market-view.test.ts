import { describe, expect, it } from "vitest";
import { decimalStringSchema, sessionDateSchema, tickerSchema } from "@fetha/contracts";

import { DAILY_TIMEFRAME, type CandleRow } from "./repositories/candle-repository";
import { toEngineCandle } from "./market-view";

describe("toEngineCandle", () => {
  it("translates a row stored under the storage timeframe into the contracts vocabulary D1 (issue #71)", () => {
    expect(DAILY_TIMEFRAME).toBe("1d");

    const row: CandleRow = {
      ticker: tickerSchema.parse("PETR4"),
      session: sessionDateSchema.parse("2026-05-11"),
      asOf: new Date("2026-05-11T21:00:00.000Z"),
      open: decimalStringSchema.parse("10.000000"),
      high: decimalStringSchema.parse("11.000000"),
      low: decimalStringSchema.parse("9.000000"),
      close: decimalStringSchema.parse("10.750000"),
      tradedQuantity: 5000,
    };

    const candle = toEngineCandle(row);

    expect(candle.timeframe).toBe("D1");
  });
});
