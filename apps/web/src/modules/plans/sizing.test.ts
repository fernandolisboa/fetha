import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { chooseLotSize } from "./sizing";

function sync(fn: (lots: number) => number | null): (lots: number) => Promise<number | null> {
  return (lots) => Promise.resolve(fn(lots));
}

describe("chooseLotSize", () => {
  it("picks the largest lot count whose max loss still fits the limit", async () => {
    const result = await chooseLotSize(
      sync((lots) => lots * 10_000),
      35_000,
    );
    expect(result).toEqual({ fits: true, lots: 3, maxLossCentavos: 30_000 });
  });

  it("reports the plan does not fit when even one lot exceeds the limit, not zero lots", async () => {
    const result = await chooseLotSize(
      sync((lots) => lots * 10_000),
      5_000,
    );
    expect(result).toEqual({ fits: false, lots: 1, maxLossCentavos: 10_000 });
  });

  it("stops at the first lot count the pricer cannot price", async () => {
    const result = await chooseLotSize(
      sync((lots) => (lots <= 2 ? lots * 10_000 : null)),
      1_000_000,
    );
    expect(result).toEqual({ fits: true, lots: 2, maxLossCentavos: 20_000 });
  });

  it("returns null when even one lot is unpriceable", async () => {
    expect(
      await chooseLotSize(
        sync(() => null),
        1_000_000,
      ),
    ).toBeNull();
  });

  it("prices lots one at a time, stopping at the first breach instead of pricing every lot up front", async () => {
    let calls = 0;
    const result = await chooseLotSize(
      sync((lots) => {
        calls += 1;
        return lots <= 3 ? lots * 10_000 : null;
      }),
      1_000_000,
    );
    expect(result).toEqual({ fits: true, lots: 3, maxLossCentavos: 30_000 });
    expect(calls).toBe(4);
  });

  it("never returns a lot count beyond what the limit allows (property)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        async (perLot, limit) => {
          const result = await chooseLotSize(
            sync((lots) => lots * perLot),
            limit,
          );
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
