import { describe, expect, it } from "vitest";
import {
  decimalStringSchema,
  instantSchema,
  sessionDateSchema,
  tickerSchema,
  type SessionDate,
} from "@fetha/contracts";
import type { Candle, CorporateActionFactor } from "@fetha/engine";

import { dividendYieldPoints, oneYearBefore, type CashDistribution } from "./dividend-yield";

function closeOf(session: string): string {
  return `${session}T21:00:00.000Z`;
}

function candle(ticker: string, session: string, close: string): Candle {
  return {
    ticker: tickerSchema.parse(ticker),
    timeframe: "D1",
    session: sessionDateSchema.parse(session),
    asOf: instantSchema.parse(closeOf(session)),
    open: decimalStringSchema.parse(close),
    high: decimalStringSchema.parse(close),
    low: decimalStringSchema.parse(close),
    close: decimalStringSchema.parse(close),
    tradedQuantity: 1000,
  };
}

function distribution(underlying: string, exDate: string, amount: string): CashDistribution {
  return {
    underlying: tickerSchema.parse(underlying),
    exDate: sessionDateSchema.parse(exDate),
    asOf: instantSchema.parse(closeOf(exDate)),
    amount: decimalStringSchema.parse(amount),
  };
}

function factor(ticker: string, exDate: string, value: string): CorporateActionFactor {
  return {
    ticker: tickerSchema.parse(ticker),
    exDate: sessionDateSchema.parse(exDate),
    asOf: instantSchema.parse(`${exDate}T13:00:00.000Z`),
    factor: decimalStringSchema.parse(value),
  };
}

function firsts(entries: Record<string, string>): Map<string, SessionDate> {
  return new Map(
    Object.entries(entries).map(([ticker, date]) => [ticker, sessionDateSchema.parse(date)]),
  );
}

describe("dividendYieldPoints", () => {
  it("divides the trailing twelve months of distributions by the session close", () => {
    const points = dividendYieldPoints(
      [candle("VALE3", "2024-08-05", "60.00")],
      [distribution("VALE3", "2024-03-12", "2.74"), distribution("VALE3", "2024-08-05", "1.78")],
      [],
      firsts({ VALE3: "2024-03-12" }),
    );
    expect(points).toEqual([
      { underlying: "VALE3", asOf: closeOf("2024-08-05"), annualYield: "0.07533333" },
    ]);
  });

  it("leaves out a distribution ex-dated exactly one year before the session", () => {
    const points = dividendYieldPoints(
      [candle("PETR4", "2025-04-26", "40.00"), candle("PETR4", "2025-04-28", "40.00")],
      [distribution("PETR4", "2024-04-26", "1.13"), distribution("PETR4", "2024-04-27", "1.00")],
      [],
      firsts({ PETR4: "2024-04-26" }),
    );
    expect(points.map((point) => point.annualYield)).toEqual(["0.025", "0"]);
  });

  it("gives no point before the underlying's first distribution and zero once all aged out", () => {
    const points = dividendYieldPoints(
      [
        candle("ABEV3", "2024-12-19", "13.00"),
        candle("ABEV3", "2024-12-20", "12.60"),
        candle("ABEV3", "2025-12-22", "14.00"),
      ],
      [distribution("ABEV3", "2024-12-20", "0.63")],
      [],
      firsts({ ABEV3: "2024-12-20" }),
    );
    expect(points.map((point) => [point.asOf, point.annualYield])).toEqual([
      [closeOf("2024-12-20"), "0.05"],
      [closeOf("2025-12-22"), "0"],
    ]);
  });

  it("starts from the first distribution ever detected, not the first one passed in", () => {
    const points = dividendYieldPoints(
      [candle("ITUB4", "2025-06-02", "35.00")],
      [],
      [],
      firsts({ ITUB4: "2024-02-01" }),
    );
    expect(points).toEqual([
      { underlying: "ITUB4", asOf: closeOf("2025-06-02"), annualYield: "0" },
    ]);
  });

  it("restates a distribution ex-dated before a split per share of the session", () => {
    const points = dividendYieldPoints(
      [candle("BBAS3", "2024-03-11", "54.00"), candle("BBAS3", "2024-05-02", "27.00")],
      [distribution("BBAS3", "2024-03-11", "1.08")],
      [factor("BBAS3", "2024-04-16", "0.5")],
      firsts({ BBAS3: "2024-03-11" }),
    );
    expect(points.map((point) => point.annualYield)).toEqual(["0.02", "0.02"]);
  });

  it("skips tickers with no distribution, intraday candles and a non-positive close", () => {
    const intraday: Candle = { ...candle("WEGE3", "2024-09-11", "50.00"), timeframe: "60m" };
    const points = dividendYieldPoints(
      [candle("MGLU3", "2024-09-11", "10.00"), intraday, candle("WEGE3", "2024-09-12", "0")],
      [distribution("WEGE3", "2024-08-05", "0.19")],
      [],
      firsts({ WEGE3: "2024-08-05" }),
    );
    expect(points).toEqual([]);
  });
});

describe("oneYearBefore", () => {
  it("moves the year back and keeps month and day", () => {
    expect(oneYearBefore(sessionDateSchema.parse("2025-03-12"))).toBe("2024-03-12");
  });
});
