import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { DecimalString } from "@fetha/contracts";

import { snapToStrike } from "./strike-snap";

function strike(value: number): DecimalString {
  return value.toFixed(2) as DecimalString;
}

describe("snapToStrike", () => {
  it("returns null for an empty strike list", () => {
    expect(snapToStrike([], 36)).toBeNull();
  });

  it("snaps to the single available strike", () => {
    expect(snapToStrike([strike(36)], 40)).toBe(strike(36));
  });

  it("snaps to the nearer of two neighbours", () => {
    const strikes = [strike(34), strike(36), strike(38)];
    expect(snapToStrike(strikes, 36.9)).toBe(strike(36));
    expect(snapToStrike(strikes, 37.1)).toBe(strike(38));
  });

  it("breaks an exact tie toward the lower strike", () => {
    expect(snapToStrike([strike(34), strike(36)], 35)).toBe(strike(34));
  });

  it("is idempotent: snapping an already-listed strike returns it unchanged", () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.integer({ min: 1, max: 200 }), { minLength: 1, maxLength: 20 })
          .map((values) => [...new Set(values)].sort((a, b) => a - b).map(strike)),
        fc.integer({ min: 0, max: 19 }),
        (strikes, index) => {
          fc.pre(index < strikes.length);
          const chosen = strikes[index];
          if (chosen === undefined) throw new Error("unreachable: index < strikes.length");
          expect(snapToStrike(strikes, Number(chosen))).toBe(chosen);
        },
      ),
    );
  });

  it("always returns a member of the candidate list", () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.integer({ min: 1, max: 200 }), { minLength: 1, maxLength: 20 })
          .map((values) => [...new Set(values)].sort((a, b) => a - b).map(strike)),
        fc.integer({ min: -50, max: 250 }),
        (strikes, target) => {
          expect(strikes).toContain(snapToStrike(strikes, target));
        },
      ),
    );
  });
});
