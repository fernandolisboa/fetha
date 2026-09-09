import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { atr } from "./atr";

type Bar = { high: Decimal; low: Decimal; close: Decimal };

const bar = (high: number, low: number, close: number): Bar => ({
  high: new Decimal(high),
  low: new Decimal(low),
  close: new Decimal(close),
});

describe("Wilder ATR (New Concepts in Technical Trading Systems, 1978)", () => {
  it("is null until length true ranges are available, then Wilder-smooths the average true range", () => {
    const bars = [
      bar(48.7, 47.79, 48.16),
      bar(48.72, 48.14, 48.61),
      bar(48.9, 48.39, 48.75),
      bar(48.87, 48.37, 48.63),
    ];
    const length = 3;
    const result = atr(bars, length);

    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBeNull();

    const tr = (high: number, low: number, prevClose: number): Decimal =>
      Decimal.max(
        new Decimal(high).sub(low),
        new Decimal(high).sub(prevClose).abs(),
        new Decimal(low).sub(prevClose).abs(),
      );
    const tr1 = tr(48.72, 48.14, 48.16);
    const tr2 = tr(48.9, 48.39, 48.61);
    const tr3 = tr(48.87, 48.37, 48.75);
    const atr3 = tr1.add(tr2).add(tr3).div(3);
    expect(result[3]?.toString()).toBe(atr3.toString());
  });

  it("smooths a fifth bar with prev * (length - 1) + current, over length", () => {
    const bars = [
      bar(48.7, 47.79, 48.16),
      bar(48.72, 48.14, 48.61),
      bar(48.9, 48.39, 48.75),
      bar(48.87, 48.37, 48.63),
      bar(48.82, 48.24, 48.74),
    ];
    const length = 3;
    const result = atr(bars, length);

    const tr = (high: number, low: number, prevClose: number): Decimal =>
      Decimal.max(
        new Decimal(high).sub(low),
        new Decimal(high).sub(prevClose).abs(),
        new Decimal(low).sub(prevClose).abs(),
      );
    const tr1 = tr(48.72, 48.14, 48.16);
    const tr2 = tr(48.9, 48.39, 48.61);
    const tr3 = tr(48.87, 48.37, 48.75);
    const atr3 = tr1.add(tr2).add(tr3).div(3);
    const tr4 = tr(48.82, 48.24, 48.63);
    const atr4 = atr3
      .mul(length - 1)
      .add(tr4)
      .div(length);
    expect(result[4]?.toString()).toBe(atr4.toString());
  });

  it("matches the published ATR(14) reference series (StockCharts.org ATR ChartSchool example, also reproduced in anandanand84/technicalindicators test fixtures)", () => {
    const high = [
      48.7, 48.72, 48.9, 48.87, 48.82, 49.05, 49.2, 49.35, 49.92, 50.19, 50.12, 49.66, 49.88, 50.19,
      50.36,
    ];
    const low = [
      47.79, 48.14, 48.39, 48.37, 48.24, 48.64, 48.94, 48.86, 49.5, 49.87, 49.2, 48.9, 49.43, 49.73,
      49.26,
    ];
    const close = [
      48.16, 48.61, 48.75, 48.63, 48.74, 49.03, 49.07, 49.32, 49.91, 50.13, 49.53, 49.5, 49.75,
      50.03, 50.31,
    ];
    const bars: Bar[] = high.map((h, i) => bar(h, low[i] as number, close[i] as number));
    const result = atr(bars, 14);
    expect(result[14]?.toDecimalPlaces(2).toString()).toBe("0.57");
  });
});
