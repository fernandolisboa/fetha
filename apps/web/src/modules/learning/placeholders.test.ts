import { describe, expect, it } from "vitest";

import { loadIllustrativeExamples } from "./illustrative-market";
import { placeholderTokens, resolvePlaceholder, resolveText } from "./placeholders";

describe("placeholderTokens", () => {
  it("extracts every {{token}} in order", () => {
    expect(placeholderTokens("spot {{spot}}, strike {{lowerStrike}}.")).toEqual([
      "spot",
      "lowerStrike",
    ]);
  });

  it("returns an empty list when there is no placeholder", () => {
    expect(placeholderTokens("plain text")).toEqual([]);
  });
});

describe("resolvePlaceholder", () => {
  it("resolves spot and strike tokens to a formatted price", async () => {
    const examples = await loadIllustrativeExamples();
    expect(resolvePlaceholder("spot", examples)).toBe("R$ 20,00");
    expect(resolvePlaceholder("lowerStrike", examples)).toBe("R$ 20,00");
    expect(resolvePlaceholder("higherStrike", examples)).toBe("R$ 22,00");
  });

  it("resolves an example's premium and max loss to a positive amount", async () => {
    const examples = await loadIllustrativeExamples();
    expect(resolvePlaceholder("long-call.premiumAbs", examples)).toBe("R$ 1,50");
    expect(resolvePlaceholder("long-call.maxLossAbs", examples)).toBe("R$ 1,50");
  });

  it("throws resolving an unbounded field instead of printing a wrong number", async () => {
    const examples = await loadIllustrativeExamples();
    expect(() => resolvePlaceholder("long-call.maxGainAbs", examples)).toThrow();
    expect(() => resolvePlaceholder("short-call.maxLossAbs", examples)).toThrow();
  });

  it("throws on an unknown token", async () => {
    const examples = await loadIllustrativeExamples();
    expect(() => resolvePlaceholder("not-a-real-token", examples)).toThrow();
  });

  it("resolves a single-leg example's ticker and its decoded series letter", async () => {
    const examples = await loadIllustrativeExamples();
    expect(resolvePlaceholder("long-call.ticker", examples)).toBe("EXMPB105");
    expect(resolvePlaceholder("long-call.tickerLetter", examples)).toBe("B");
    expect(resolvePlaceholder("long-put.ticker", examples)).toBe("EXMPN105");
    expect(resolvePlaceholder("long-put.tickerLetter", examples)).toBe("N");
  });

  it("throws resolving a ticker on a multi-leg example, which names no single series", async () => {
    const examples = await loadIllustrativeExamples();
    expect(() => resolvePlaceholder("bull-call-spread.ticker", examples)).toThrow();
    expect(() => resolvePlaceholder("bull-call-spread.tickerLetter", examples)).toThrow();
  });
});

describe("resolveText", () => {
  it("replaces every placeholder in a sentence", async () => {
    const examples = await loadIllustrativeExamples();
    const text = resolveText("Spot {{spot}}, premium {{long-call.premiumAbs}}.", examples);
    expect(text).toBe("Spot R$ 20,00, premium R$ 1,50.");
  });
});
