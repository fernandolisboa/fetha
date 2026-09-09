import { describe, expect, it } from "vitest";
import type { Candle, CorporateActionFactor, ImpliedVolatilityIndexPoint } from "../api";
import { decimalString } from "../test/support";
import { batchTruncationReport } from "./batch-truncation";

const candle = (ticker: string, asOf: string): Candle => ({
  ticker,
  timeframe: "D1",
  session: asOf.slice(0, 10),
  asOf,
  open: decimalString("10.00"),
  high: decimalString("10.00"),
  low: decimalString("10.00"),
  close: decimalString("10.00"),
  tradedQuantity: 1,
});

describe("batchTruncationReport", () => {
  it("counts rows after `at` for referenced instruments", () => {
    const report = batchTruncationReport({
      candles: [
        candle("PETR4", "2024-01-01T20:00:00.000Z"),
        candle("PETR4", "2024-01-02T20:00:00.000Z"),
      ],
      corporateActions: [],
      impliedVolatilityIndex: [],
      instruments: ["PETR4"],
      at: "2024-01-01T20:00:00.000Z",
      needsIv: false,
    });
    expect(report).toEqual([
      { collection: "candles", ticker: "PETR4", dropped: 1, reason: "after_at" },
    ]);
  });

  it("counts rows for instruments the call does not reference", () => {
    const report = batchTruncationReport({
      candles: [
        candle("PETR4", "2024-01-01T20:00:00.000Z"),
        candle("VALE3", "2024-01-01T20:00:00.000Z"),
      ],
      corporateActions: [],
      impliedVolatilityIndex: [],
      instruments: ["PETR4"],
      at: "2024-01-05T20:00:00.000Z",
      needsIv: false,
    });
    expect(report).toEqual([
      { collection: "candles", ticker: "VALE3", dropped: 1, reason: "unreferenced_instrument" },
    ]);
  });

  it("counts corporate-action factors and implied-volatility index points when needed", () => {
    const factor: CorporateActionFactor = {
      ticker: "PETR4",
      exDate: "2024-01-10",
      asOf: "2024-02-01T13:00:00.000Z",
      factor: decimalString("0.5"),
    };
    const ivPoint: ImpliedVolatilityIndexPoint = {
      underlying: "PETR4",
      session: "2024-02-01",
      asOf: "2024-02-01T20:00:00.000Z",
      impliedVolatility: decimalString("0.3"),
    };
    const report = batchTruncationReport({
      candles: [],
      corporateActions: [factor],
      impliedVolatilityIndex: [ivPoint],
      instruments: ["PETR4"],
      at: "2024-01-05T20:00:00.000Z",
      needsIv: true,
    });
    expect(report).toEqual([
      { collection: "corporateActions", ticker: "PETR4", dropped: 1, reason: "after_at" },
      { collection: "impliedVolatilityIndex", ticker: "PETR4", dropped: 1, reason: "after_at" },
    ]);
  });

  it("does not report implied-volatility index truncation when iv_rank is not needed", () => {
    const ivPoint: ImpliedVolatilityIndexPoint = {
      underlying: "PETR4",
      session: "2024-02-01",
      asOf: "2024-02-01T20:00:00.000Z",
      impliedVolatility: decimalString("0.3"),
    };
    const report = batchTruncationReport({
      candles: [],
      corporateActions: [],
      impliedVolatilityIndex: [ivPoint],
      instruments: ["PETR4"],
      at: "2024-01-05T20:00:00.000Z",
      needsIv: false,
    });
    expect(report).toEqual([]);
  });
});
