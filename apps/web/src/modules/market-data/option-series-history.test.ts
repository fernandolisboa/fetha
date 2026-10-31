import { describe, expect, it } from "vitest";
import {
  decimalStringSchema,
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
  type DecimalString,
} from "@fetha/contracts";
import { engine } from "@fetha/engine";

import {
  assembleOptionSeriesHistoryView,
  computeOptionSeriesHistory,
  type OptionSeriesHistoryRows,
  type OptionSeriesHistoryTarget,
} from "./option-series-history";

const TICKER = tickerSchema.parse("PETRC400");
const UNDERLYING = tickerSchema.parse("PETR4");
const EXPIRY = sessionDateSchema.parse("2026-03-20");
const SESSIONS = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"];
const CALENDAR_DATES = [
  ...SESSIONS,
  "2026-03-09",
  "2026-03-10",
  "2026-03-11",
  "2026-03-12",
  "2026-03-13",
  "2026-03-16",
  "2026-03-17",
  "2026-03-18",
  "2026-03-19",
  "2026-03-20",
];
const SIGMA = 0.3;

const target: OptionSeriesHistoryTarget = {
  ticker: TICKER,
  underlying: UNDERLYING,
  right: "call",
  expiry: EXPIRY,
};

function closeOf(session: string): Date {
  return new Date(`${session}T20:00:00.000Z`);
}

function baseRows(closes: Array<DecimalString | null>): OptionSeriesHistoryRows {
  return {
    epochs: [
      {
        ticker: TICKER,
        underlying: UNDERLYING,
        right: "call",
        strike: "40.00000000",
        expiry: EXPIRY,
        style: "european",
        asOf: closeOf("2026-02-27"),
        priceFactor: "1",
        settlementStyle: "physical",
      },
    ],
    prices: SESSIONS.map((session, index) => ({
      ticker: TICKER,
      session,
      asOf: closeOf(session),
      right: "call",
      strike: "40.00000000",
      expiry: EXPIRY,
      average: closes[index] ?? null,
      close: closes[index] ?? null,
      factor: "1.000000",
      trades: closes[index] ? 10 : 0,
      tradedQuantity: closes[index] ? 1000 : 0,
    })).reverse(),
    candles: SESSIONS.map((session, index) => ({
      ticker: UNDERLYING,
      session: sessionDateSchema.parse(session),
      asOf: closeOf(session),
      open: decimalStringSchema.parse("40.000000"),
      high: decimalStringSchema.parse("41.000000"),
      low: decimalStringSchema.parse("39.000000"),
      close: decimalStringSchema.parse(`${String(40 + index)}.000000`),
      tradedQuantity: 100000,
    })),
    calendar: CALENDAR_DATES.map((date) => ({
      date,
      open: new Date(`${date}T13:00:00.000Z`),
      close: closeOf(date),
    })),
    macro: [
      {
        series: "cdi",
        date: "2026-02-27",
        asOf: new Date("2026-03-02T13:00:00.000Z"),
        annualRate: "0.14150000",
      },
    ],
    corporateActions: [],
  };
}

// The engine itself prices each session at the target volatility, so the close fed back in is
// one the model reproduces exactly and the solve must recover SIGMA.
async function closesImpliedBy(sigma: number): Promise<DecimalString[]> {
  const probe = baseRows(SESSIONS.map(() => decimalStringSchema.parse("1.000000")));
  const view = assembleOptionSeriesHistoryView(probe);
  const closes: DecimalString[] = [];
  for (const session of SESSIONS) {
    const at = view.calendar.find((day) => day.date === session)?.close;
    if (!at) throw new Error("fixture session missing from the calendar");
    const priced = await engine.priceOperation({
      view,
      at,
      legs: [
        {
          role: "call",
          side: "buy",
          ticker: TICKER,
          quantity: quantitySchema.parse(1),
          volatility: decimalStringSchema.parse(sigma.toFixed(6)),
        },
      ],
    });
    const fairValue = priced.ok ? priced.value.legs[0]?.fairValue : null;
    if (!fairValue) throw new Error("fixture session could not be priced");
    closes.push(fairValue);
  }
  return closes;
}

describe("computeOptionSeriesHistory", () => {
  it("returns the sessions oldest first, with the close and the underlying's close on each", async () => {
    const closes = await closesImpliedBy(SIGMA);

    const history = await computeOptionSeriesHistory(target, baseRows(closes));

    expect(history.map((point) => point.session)).toEqual(SESSIONS);
    expect(history.map((point) => point.close)).toEqual(closes);
    expect(history.map((point) => point.underlyingClose)).toEqual([
      "40.000000",
      "41.000000",
      "42.000000",
      "43.000000",
      "44.000000",
    ]);
  });

  it("solves the implied volatility on every session from the engine", async () => {
    const closes = await closesImpliedBy(SIGMA);

    const history = await computeOptionSeriesHistory(target, baseRows(closes));

    expect(history).toHaveLength(SESSIONS.length);
    for (const point of history) {
      expect(point.impliedVolatility).not.toBeNull();
      expect(Math.abs(Number(point.impliedVolatility) - SIGMA)).toBeLessThan(0.005);
    }
  });

  it("leaves the volatility empty on a session with no price", async () => {
    const closes = await closesImpliedBy(SIGMA);
    const withGap = [
      closes[0] ?? null,
      null,
      closes[2] ?? null,
      closes[3] ?? null,
      closes[4] ?? null,
    ];

    const history = await computeOptionSeriesHistory(target, baseRows(withGap));

    const gap = history[1];
    expect(gap?.close).toBeNull();
    expect(gap?.impliedVolatility).toBeNull();
    expect(history[2]?.impliedVolatility).not.toBeNull();
  });

  it("leaves the volatility empty rather than solving it with a defaulted risk-free rate", async () => {
    const closes = await closesImpliedBy(SIGMA);

    const history = await computeOptionSeriesHistory(target, { ...baseRows(closes), macro: [] });

    expect(history.map((point) => point.close)).toEqual(closes);
    expect(history.every((point) => point.impliedVolatility === null)).toBe(true);
  });

  it("leaves the underlying's close empty on a session its candle is missing", async () => {
    const closes = await closesImpliedBy(SIGMA);
    const rows = baseRows(closes);

    const history = await computeOptionSeriesHistory(target, {
      ...rows,
      candles: rows.candles.filter((candle) => candle.session !== "2026-03-04"),
    });

    expect(history[2]?.underlyingClose).toBeNull();
    expect(history[3]?.underlyingClose).toBe("43.000000");
  });

  it("leaves the volatility empty on a session its underlying candle is missing, never solving against an older spot", async () => {
    const closes = await closesImpliedBy(SIGMA);
    const rows = baseRows(closes);

    const history = await computeOptionSeriesHistory(target, {
      ...rows,
      candles: rows.candles.filter((candle) => candle.session !== "2026-03-04"),
    });

    expect(history[2]?.impliedVolatility).toBeNull();
    expect(history[1]?.impliedVolatility).not.toBeNull();
    expect(history[3]?.impliedVolatility).not.toBeNull();
  });

  it("leaves the volatility empty on sessions before the registry first listed the series", async () => {
    const closes = await closesImpliedBy(SIGMA);
    const rows = baseRows(closes);
    const [epoch] = rows.epochs;
    if (!epoch) throw new Error("fixture epoch missing");

    const history = await computeOptionSeriesHistory(target, {
      ...rows,
      epochs: [{ ...epoch, asOf: closeOf("2026-03-04") }],
    });

    expect(history.map((point) => point.impliedVolatility === null)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("leaves the volatility empty on a session whose price was recorded under a strike other than the latest epoch's", async () => {
    const closes = await closesImpliedBy(SIGMA);
    const rows = baseRows(closes);
    const [epoch] = rows.epochs;
    if (!epoch) throw new Error("fixture epoch missing");

    const history = await computeOptionSeriesHistory(target, {
      ...rows,
      epochs: [epoch, { ...epoch, strike: "44.00000000", asOf: closeOf("2026-03-04") }],
    });

    expect(history.map((point) => point.impliedVolatility === null)).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it("solves the volatility once the price carries the latest epoch's strike", async () => {
    const closes = await closesImpliedBy(SIGMA);
    const rows = baseRows(closes);
    const [epoch] = rows.epochs;
    if (!epoch) throw new Error("fixture epoch missing");

    const history = await computeOptionSeriesHistory(target, {
      ...rows,
      epochs: [
        { ...epoch, strike: "38.00000000" },
        { ...epoch, asOf: closeOf("2026-03-04") },
      ],
    });

    expect(history.map((point) => point.impliedVolatility === null)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("leaves the volatility empty when the strike may not reflect a corporate action on the underlying", async () => {
    const closes = await closesImpliedBy(SIGMA);

    const history = await computeOptionSeriesHistory(target, {
      ...baseRows(closes),
      corporateActions: [
        {
          ticker: UNDERLYING,
          exDate: sessionDateSchema.parse("2026-03-04"),
          asOf: closeOf("2026-03-03"),
          factor: decimalStringSchema.parse("0.900000"),
          recordedAt: closeOf("2026-03-03"),
        },
      ],
    });

    expect(history[0]?.impliedVolatility).not.toBeNull();
    expect(history[1]?.impliedVolatility).not.toBeNull();
    expect(history[3]?.impliedVolatility).toBeNull();
    expect(history[4]?.impliedVolatility).toBeNull();
  });
});

describe("assembleOptionSeriesHistoryView", () => {
  it("keeps one cdi point per as-of, the fresher observation first", () => {
    const rows = baseRows([]);
    const asOf = new Date("2026-03-02T13:00:00.000Z");

    const view = assembleOptionSeriesHistoryView({
      ...rows,
      macro: [
        { series: "cdi", date: "2026-02-27", asOf, annualRate: "0.14150000" },
        { series: "cdi", date: "2026-02-26", asOf, annualRate: "0.14000000" },
        { series: "selic", date: "2026-02-27", asOf, annualRate: "0.15000000" },
      ],
    });

    expect(view.macro).toHaveLength(1);
    expect(view.macro[0]?.annualRate).toBe("0.14150000");
  });

  it("keeps each epoch visible from its own as-of, never from an earlier price", () => {
    const rows = baseRows(SESSIONS.map(() => decimalStringSchema.parse("1.000000")));
    const [epoch] = rows.epochs;
    if (!epoch) throw new Error("fixture epoch missing");

    const view = assembleOptionSeriesHistoryView({
      ...rows,
      epochs: [{ ...epoch, asOf: closeOf("2026-03-04") }],
    });

    expect(view.optionSeries).toHaveLength(1);
    expect(view.optionSeries[0]?.asOf).toBe(closeOf("2026-03-04").toISOString());
  });
});
