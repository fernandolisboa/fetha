import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { add, type Money } from "./money";

const safeCentavos = fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 });

function brl(amountCentavos: number): Money {
  return { amountCentavos, currency: "BRL" };
}

describe("add property tests", () => {
  it("is commutative", () => {
    fc.assert(
      fc.property(safeCentavos, safeCentavos, (a, b) => {
        expect(add(brl(a), brl(b))).toEqual(add(brl(b), brl(a)));
      }),
    );
  });

  it("is associative", () => {
    fc.assert(
      fc.property(safeCentavos, safeCentavos, safeCentavos, (a, b, c) => {
        expect(add(add(brl(a), brl(b)), brl(c))).toEqual(add(brl(a), add(brl(b), brl(c))));
      }),
    );
  });
});
