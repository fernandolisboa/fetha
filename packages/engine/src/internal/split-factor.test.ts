import { describe, expect, it } from "vitest";
import type { SessionDate } from "@fetha/contracts";
import type { CorporateActionFactor } from "../api";
import { decimalString } from "../test/support";
import { splitFactorProduct } from "./split-factor";

const session = (date: string): SessionDate => date;

function factor(exDate: string, value: string): CorporateActionFactor {
  return {
    ticker: "PETR4",
    exDate: session(exDate),
    asOf: `${exDate}T13:00:00.000Z`,
    factor: decimalString(value),
  };
}

describe("splitFactorProduct", () => {
  it("excludes a factor whose exDate equals openedAt (not strictly after)", () => {
    const f = factor("2024-01-03", "0.5");
    const result = splitFactorProduct([f], session("2024-01-03"), session("2024-01-05"));
    expect(result.toString()).toBe("1");
  });

  it("includes a factor whose exDate is the session right after openedAt", () => {
    const f = factor("2024-01-04", "0.5");
    const result = splitFactorProduct([f], session("2024-01-03"), session("2024-01-05"));
    expect(result.toString()).toBe("0.5");
  });

  it("includes a factor whose exDate equals through (not strictly before)", () => {
    const f = factor("2024-01-05", "0.5");
    const result = splitFactorProduct([f], session("2024-01-03"), session("2024-01-05"));
    expect(result.toString()).toBe("0.5");
  });

  it("excludes a factor whose exDate is the session right after through", () => {
    const f = factor("2024-01-06", "0.5");
    const result = splitFactorProduct([f], session("2024-01-03"), session("2024-01-05"));
    expect(result.toString()).toBe("1");
  });

  it("multiplies every factor inside the (openedAt, through] window", () => {
    const first = factor("2024-01-04", "0.5");
    const second = factor("2024-01-05", "2");
    const outside = factor("2024-01-03", "3");
    const result = splitFactorProduct(
      [first, second, outside],
      session("2024-01-03"),
      session("2024-01-05"),
    );
    expect(result.toString()).toBe("1");
  });

  it("returns 1 for an empty factor list", () => {
    const result = splitFactorProduct([], session("2024-01-03"), session("2024-01-05"));
    expect(result.toString()).toBe("1");
  });
});
