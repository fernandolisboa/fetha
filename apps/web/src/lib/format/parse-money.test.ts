import { describe, expect, it } from "vitest";

import { parseCentavosInput } from "./parse-money";

describe("parseCentavosInput", () => {
  it("parses a pt-BR thousands-grouped amount as ten thousand reais, not ten", () => {
    expect(parseCentavosInput("10.000")).toBe(10_000_00);
  });

  it("parses a grouped amount with cents", () => {
    expect(parseCentavosInput("10.000,50")).toBe(10_000_50);
  });

  it("parses an ungrouped amount", () => {
    expect(parseCentavosInput("10000")).toBe(10_000_00);
  });

  it("parses a single cents digit", () => {
    expect(parseCentavosInput("100,5")).toBe(10_050);
  });

  it("rejects a stray decimal point (ambiguous with a thousands separator)", () => {
    expect(parseCentavosInput("10.5")).toBeNull();
  });

  it("rejects more than two decimal digits", () => {
    expect(parseCentavosInput("100,999")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(parseCentavosInput("")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    expect(parseCentavosInput("abc")).toBeNull();
  });
});
