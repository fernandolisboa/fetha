import { describe, expect, it } from "vitest";

import { parsePriceInput } from "./parse-price";

describe("parsePriceInput", () => {
  it.each([
    ["38,42", "38.42"],
    ["1.234,5", "1234.5"],
    ["0,012345", "0.012345"],
    ["40", "40"],
  ])("reads %s as %s", (raw, expected) => {
    expect(parsePriceInput(raw)).toBe(expected);
  });

  it.each(["", "38.42", "-1", "1,1234567", "abc", "0"])("refuses %j", (raw) => {
    expect(parsePriceInput(raw)).toBeNull();
  });

  it("accepts zero only when asked to", () => {
    expect(parsePriceInput("0,00", { allowZero: true })).toBe("0");
  });
});
