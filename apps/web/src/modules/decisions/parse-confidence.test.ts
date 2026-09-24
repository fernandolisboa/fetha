import { describe, expect, it } from "vitest";

import { parseConfidencePercent } from "./parse-confidence";

describe("parseConfidencePercent", () => {
  it("parses a whole percent into a decimal-string fraction", () => {
    expect(parseConfidencePercent("62")).toBe("0.62");
  });

  it("parses a pt-BR comma decimal percent", () => {
    expect(parseConfidencePercent("62,5")).toBe("0.625");
  });

  it("accepts the boundary 0", () => {
    expect(parseConfidencePercent("0")).toBe("0");
  });

  it("accepts the boundary 100", () => {
    expect(parseConfidencePercent("100")).toBe("1");
  });

  it("rejects a value above 100", () => {
    expect(parseConfidencePercent("100,1")).toBeNull();
  });

  it("rejects a negative value", () => {
    expect(parseConfidencePercent("-5")).toBeNull();
  });

  it("rejects an empty or non-numeric input", () => {
    expect(parseConfidencePercent("")).toBeNull();
    expect(parseConfidencePercent("abc")).toBeNull();
  });

  it("rejects hexadecimal notation", () => {
    expect(parseConfidencePercent("0x40")).toBeNull();
  });

  it("rejects exponent notation", () => {
    expect(parseConfidencePercent("1e1")).toBeNull();
  });
});
