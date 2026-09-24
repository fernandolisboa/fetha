import { describe, expect, it } from "vitest";

import { parseLevelInput } from "./parse-level";

describe("parseLevelInput", () => {
  it("parses a plain pt-BR decimal", () => {
    expect(parseLevelInput("38,42")).toBe("38.42");
  });

  it("parses a thousands-separated value", () => {
    expect(parseLevelInput("1.234,56")).toBe("1234.56");
  });

  it("parses an integer with no decimals", () => {
    expect(parseLevelInput("40")).toBe("40");
  });

  it("rejects zero: a level must be strictly positive", () => {
    expect(parseLevelInput("0")).toBeNull();
  });

  it("rejects a negative value", () => {
    expect(parseLevelInput("-1")).toBeNull();
  });

  it("rejects a malformed string", () => {
    expect(parseLevelInput("abc")).toBeNull();
    expect(parseLevelInput("")).toBeNull();
  });
});
