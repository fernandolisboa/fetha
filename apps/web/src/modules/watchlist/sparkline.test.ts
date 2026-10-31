import { decimalStringSchema, type DecimalString } from "@fetha/contracts";
import { describe, expect, it } from "vitest";

import { formatPercent } from "@/lib/format/percent";

import { buildSparkline } from "./sparkline";

function closes(...values: string[]): DecimalString[] {
  return values.map((value) => decimalStringSchema.parse(value));
}

function printedChange(values: DecimalString[]): string | null {
  const sparkline = buildSparkline(values);
  return sparkline ? formatPercent(sparkline.changeFraction) : null;
}

describe("buildSparkline", () => {
  it("returns null for no close or a single close", () => {
    expect(buildSparkline([])).toBeNull();
    expect(buildSparkline(closes("10"))).toBeNull();
  });

  it("returns null when the first close is zero", () => {
    expect(buildSparkline(closes("0", "10"))).toBeNull();
  });

  it("is up when the last close is above the first and prints the change", () => {
    const values = closes("100", "101", "102.08");
    expect(buildSparkline(values)?.direction).toBe("up");
    expect(printedChange(values)).toBe("2,08%");
  });

  it("is down when the last close is below the first and prints a true minus", () => {
    const values = closes("100", "99", "97.92");
    expect(buildSparkline(values)?.direction).toBe("down");
    expect(printedChange(values)).toBe("−2,08%");
  });

  it("counts a flat window as up with a zero change", () => {
    const sparkline = buildSparkline(closes("10", "10", "10"));
    expect(sparkline?.direction).toBe("up");
    expect(sparkline?.changeFraction).toBe("0.00000000");
  });

  it("keeps only the last 30 closes", () => {
    const many = closes(...Array.from({ length: 40 }, (_, index) => String(100 + index)));
    const sparkline = buildSparkline(many);
    expect(sparkline?.sessions).toBe(30);
    expect(sparkline?.points.split(" ")).toHaveLength(30);
    expect(printedChange(many)).toBe("26,36%");
  });

  it("maps the lowest close to the bottom and the highest to the top, left to right", () => {
    const sparkline = buildSparkline(closes("10", "20", "15"), { width: 100, height: 20 });
    expect(sparkline?.points).toBe("2.00,18.00 50.00,2.00 98.00,10.00");
  });

  it("draws a flat window as a horizontal line in the middle", () => {
    const sparkline = buildSparkline(closes("10", "10"), { width: 100, height: 20 });
    expect(sparkline?.points).toBe("2.00,10.00 98.00,10.00");
  });

  it("does not round the percent through floating point", () => {
    expect(buildSparkline(closes("0.1", "0.3"))?.changeFraction).toBe("2.00000000");
  });
});
