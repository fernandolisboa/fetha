import { describe, expect, it } from "vitest";
import type { Instant } from "@fetha/contracts";
import { compareInstants, isAfter, isAtOrBefore } from "./instant";

const instant = (value: string): Instant => value;

describe("compareInstants", () => {
  it("compares chronologically, not lexicographically, across mixed precision", () => {
    const noMs = instant("2024-01-04T20:00:00Z");
    const withMs = instant("2024-01-04T20:00:00.000Z");
    expect(compareInstants(noMs, withMs)).toBe(0);
    expect(noMs > withMs).toBe(true);
  });

  it("orders an earlier instant before a later one regardless of string length", () => {
    const earlier = instant("2024-01-04T19:59:59.999Z");
    const later = instant("2024-01-04T20:00:00Z");
    expect(compareInstants(earlier, later)).toBeLessThan(0);
  });
});

describe("isAfter", () => {
  it("is false when the instants are equal, even with mixed precision", () => {
    expect(isAfter(instant("2024-01-04T20:00:00Z"), instant("2024-01-04T20:00:00.000Z"))).toBe(
      false,
    );
  });

  it("is true only when a is strictly later than b", () => {
    expect(isAfter(instant("2024-01-04T20:00:00.001Z"), instant("2024-01-04T20:00:00.000Z"))).toBe(
      true,
    );
  });
});

describe("isAtOrBefore", () => {
  it("is true when the instants are equal (visibility is inclusive)", () => {
    expect(isAtOrBefore(instant("2024-01-04T20:00:00Z"), instant("2024-01-04T20:00:00.000Z"))).toBe(
      true,
    );
  });

  it("is false when a is strictly later than b", () => {
    expect(
      isAtOrBefore(instant("2024-01-04T20:00:00.001Z"), instant("2024-01-04T20:00:00.000Z")),
    ).toBe(false);
  });
});
