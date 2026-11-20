import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { chooseLotSize } from "./sizing";

describe("chooseLotSize", () => {
  it("picks the largest lot count whose max loss still fits the limit", () => {
    const result = chooseLotSize((lots) => lots * 10_000, 35_000);
    expect(result).toEqual({ fits: true, lots: 3, maxLossCentavos: 30_000 });
  });

  it("reports the plan does not fit when even one lot exceeds the limit, not zero lots", () => {
    const result = chooseLotSize((lots) => lots * 10_000, 5_000);
    expect(result).toEqual({ fits: false, lots: 1, maxLossCentavos: 10_000 });
  });

  it("stops at the first lot count the pricer cannot price", () => {
    const result = chooseLotSize((lots) => (lots <= 2 ? lots * 10_000 : null), 1_000_000);
    expect(result).toEqual({ fits: true, lots: 2, maxLossCentavos: 20_000 });
  });

  it("returns null when even one lot is unpriceable", () => {
    expect(chooseLotSize(() => null, 1_000_000)).toBeNull();
  });

  it("never returns a lot count beyond what the limit allows (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        (perLot, limit) => {
          const result = chooseLotSize((lots) => lots * perLot, limit);
          if (!result) return;
          expect(result.maxLossCentavos).toBeLessThanOrEqual(
            result.fits ? limit : Number.POSITIVE_INFINITY,
          );
          if (result.fits) {
            expect(result.lots * perLot).toBeLessThanOrEqual(limit);
          }
        },
      ),
    );
  });
});
