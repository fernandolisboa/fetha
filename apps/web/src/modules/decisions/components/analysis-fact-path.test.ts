import { describe, expect, it } from "vitest";
import type { AnalysisFacts } from "@fetha/contracts";

import { resolveFactAtPath } from "./analysis-fact-path";

describe("resolveFactAtPath", () => {
  const facts: AnalysisFacts = {
    ticker: "PETR4",
    pricing: {
      legs: [{ strike: "R$ 30,00" }, { strike: "R$ 32,00" }],
      netPremium: "R$ 1.234,56",
    },
    nullable: null,
  };

  it("resolves a top-level string leaf", () => {
    expect(resolveFactAtPath(facts, "ticker")).toBe("PETR4");
  });

  it("resolves a nested object leaf", () => {
    expect(resolveFactAtPath(facts, "pricing.netPremium")).toBe("R$ 1.234,56");
  });

  it("resolves a list index", () => {
    expect(resolveFactAtPath(facts, "pricing.legs.1.strike")).toBe("R$ 32,00");
  });

  it("returns the node itself when the path stops at an object", () => {
    expect(resolveFactAtPath(facts, "pricing")).toEqual(facts.pricing);
  });

  it("returns the node itself when the path stops at a list", () => {
    expect(resolveFactAtPath(facts, "pricing.legs")).toEqual(
      facts.pricing && (facts.pricing as Record<string, unknown>).legs,
    );
  });

  it("returns undefined for a missing key", () => {
    expect(resolveFactAtPath(facts, "pricing.unknown")).toBeUndefined();
  });

  it("returns undefined for an out-of-range index", () => {
    expect(resolveFactAtPath(facts, "pricing.legs.9.strike")).toBeUndefined();
  });

  it("returns undefined when traversing past a string leaf", () => {
    expect(resolveFactAtPath(facts, "ticker.extra")).toBeUndefined();
  });

  it("returns undefined when traversing past a null leaf", () => {
    expect(resolveFactAtPath(facts, "nullable.extra")).toBeUndefined();
  });

  it("returns undefined for a non-numeric list segment", () => {
    expect(resolveFactAtPath(facts, "pricing.legs.first.strike")).toBeUndefined();
  });
});
