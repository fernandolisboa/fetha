import { describe, expect, it } from "vitest";
import type { ImpliedVolatilityIndexPoint } from "../api";
import { buildIvIndexSeries } from "./iv-index-series";
import { decimalString } from "../test/support";

const point = (session: string, iv: string): ImpliedVolatilityIndexPoint => ({
  underlying: "PETR4",
  session,
  asOf: `${session}T21:00:00.000Z`,
  impliedVolatility: decimalString(iv),
});

describe("buildIvIndexSeries", () => {
  it("sorts points by session regardless of input order", () => {
    const points = [point("2024-01-03", "0.3"), point("2024-01-02", "0.2")];
    const result = buildIvIndexSeries({
      points,
      underlying: "PETR4",
      at: "2024-01-03T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.points.map((p) => p.session)).toEqual(["2024-01-02", "2024-01-03"]);
  });

  it("drops points after the truncation instant and reports them", () => {
    const points = [point("2024-01-02", "0.2"), point("2024-01-03", "0.3")];
    const result = buildIvIndexSeries({
      points,
      underlying: "PETR4",
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.points).toHaveLength(1);
    expect(result.value.truncated).toContainEqual({
      collection: "impliedVolatilityIndex",
      ticker: "PETR4",
      dropped: 1,
      reason: "after_at",
    });
  });

  it("drops points for other underlyings and reports them", () => {
    const points = [
      point("2024-01-02", "0.2"),
      { ...point("2024-01-02", "0.4"), underlying: "VALE3" },
    ];
    const result = buildIvIndexSeries({
      points,
      underlying: "PETR4",
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.points).toHaveLength(1);
    expect(result.value.truncated).toContainEqual({
      collection: "impliedVolatilityIndex",
      ticker: "VALE3",
      dropped: 1,
      reason: "unreferenced_instrument",
    });
  });

  it("rejects duplicate underlying+session keys as invalid input", () => {
    const points = [point("2024-01-02", "0.2"), point("2024-01-02", "0.3")];
    const result = buildIvIndexSeries({
      points,
      underlying: "PETR4",
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(false);
  });

  it("compares asOf chronologically, not lexicographically, across mixed millisecond precision", () => {
    const points: ImpliedVolatilityIndexPoint[] = [
      {
        underlying: "PETR4",
        session: "2024-01-02",
        asOf: "2024-01-02T21:00:00Z",
        impliedVolatility: decimalString("0.2"),
      },
    ];
    const result = buildIvIndexSeries({
      points,
      underlying: "PETR4",
      at: "2024-01-02T21:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.points).toHaveLength(1);
    expect(result.value.truncated).toEqual([]);
  });

  it("keeps a point whose asOf equals the truncation instant visible and not truncated", () => {
    const points = [point("2024-01-02", "0.2")];
    const result = buildIvIndexSeries({
      points,
      underlying: "PETR4",
      at: "2024-01-02T21:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.truncated).toEqual([]);
  });

  it("sorts points by (underlying, session), not by session alone across underlyings", () => {
    const points: ImpliedVolatilityIndexPoint[] = [
      { ...point("2024-01-03", "0.3"), underlying: "VALE3" },
      point("2024-01-02", "0.2"),
      { ...point("2024-01-01", "0.1"), underlying: "VALE3" },
    ];
    const result = buildIvIndexSeries({
      points,
      underlying: "VALE3",
      at: "2024-01-05T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.points.map((p) => p.session)).toEqual(["2024-01-01", "2024-01-03"]);
  });

  it("reports unreferenced-underlying drops in a deterministic order regardless of input order", () => {
    const points: ImpliedVolatilityIndexPoint[] = [
      { ...point("2024-01-02", "0.2"), underlying: "VALE3" },
      { ...point("2024-01-02", "0.2"), underlying: "ABEV3" },
    ];
    const result = buildIvIndexSeries({
      points,
      underlying: "PETR4",
      at: "2024-01-02T23:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const otherUnderlyings = result.value.truncated
      .filter((t) => t.reason === "unreferenced_instrument")
      .map((t) => t.ticker);
    expect(otherUnderlyings).toEqual(["ABEV3", "VALE3"]);
  });
});
