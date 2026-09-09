import { describe, expect, it } from "vitest";
import { centavos, decimalString } from "../test/support";
import { sizeStockEntry } from "./sizing";

describe("sizeStockEntry", () => {
  it("sizes a fixed_fractional entry from declared capital and the entry price", () => {
    const result = sizeStockEntry({
      sizing: { kind: "fixed_fractional", fraction: decimalString("0.10") },
      declaredCapital: centavos(100_000_00),
      legs: [{ side: "buy", ratio: 1 }],
      price: decimalString("25.00"),
    });
    expect(result).toEqual({ ok: true, units: 400 });
  });

  it("is unsizeable without declared capital", () => {
    const result = sizeStockEntry({
      sizing: { kind: "fixed_fractional", fraction: decimalString("0.10") },
      declaredCapital: null,
      legs: [{ side: "buy", ratio: 1 }],
      price: decimalString("25.00"),
    });
    expect(result).toEqual({ ok: false, detail: "no_declared_capital" });
  });

  it("is unsizeable when the fraction yields fewer than one unit", () => {
    const result = sizeStockEntry({
      sizing: { kind: "fixed_fractional", fraction: decimalString("0.10") },
      declaredCapital: centavos(100_00),
      legs: [{ side: "buy", ratio: 1 }],
      price: decimalString("25.00"),
    });
    expect(result).toEqual({ ok: false, detail: "zero_units" });
  });

  it("is unsizeable when the price is non-positive, never dividing by zero", () => {
    const result = sizeStockEntry({
      sizing: { kind: "fixed_fractional", fraction: decimalString("1") },
      declaredCapital: centavos(100_000_00),
      legs: [{ side: "buy", ratio: 1 }],
      price: decimalString("0.00"),
    });
    expect(result).toEqual({ ok: false, detail: "zero_units" });
  });

  it("sizes fixed_risk against declared capital and a bounded long stock loss", () => {
    const result = sizeStockEntry({
      sizing: { kind: "fixed_risk", fraction: decimalString("0.01") },
      declaredCapital: centavos(100_000_00),
      legs: [{ side: "buy", ratio: 1 }],
      price: decimalString("25.00"),
    });
    expect(result).toEqual({ ok: true, units: 40 });
  });

  it("is unsizeable under fixed_risk when a leg is a short stock (unbounded max loss)", () => {
    const result = sizeStockEntry({
      sizing: { kind: "fixed_risk", fraction: decimalString("0.01") },
      declaredCapital: centavos(100_000_00),
      legs: [{ side: "sell", ratio: 1 }],
      price: decimalString("25.00"),
    });
    expect(result).toEqual({ ok: false, detail: "unbounded_max_loss" });
  });

  it("sums ratio across multiple legs of the same structure", () => {
    const result = sizeStockEntry({
      sizing: { kind: "fixed_fractional", fraction: decimalString("1") },
      declaredCapital: centavos(10_000_00),
      legs: [
        { side: "buy", ratio: 2 },
        { side: "buy", ratio: 1 },
      ],
      price: decimalString("10.00"),
    });
    expect(result).toEqual({ ok: true, units: 333 });
  });
});
