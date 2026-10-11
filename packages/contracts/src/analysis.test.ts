import { describe, expect, it } from "vitest";

import {
  analysisInputsSchema,
  analysisOutputSchema,
  checkAnalysisCitations,
  factAt,
  figuresIn,
  type AnalysisFact,
  type AnalysisInputs,
  type AnalysisOutput,
} from "./analysis";

const inputs: AnalysisInputs = {
  subject: "contemplated_operation",
  facts: {
    session: "09/10/2026",
    underlying: "PETR4",
    pricing: {
      spot: "R$ 31,20",
      maxLoss: "−R$ 1.234,56",
      maxGain: "R$ 765,44",
      breakEvens: ["R$ 30,15"],
      riskFreeRate: "10,65% a.a.",
      legs: [{ ticker: "PETRK320", strike: "R$ 32,00", expiry: "16/11/2026", delta: "0,45" }],
    },
    sessionsToExpiry: "28 sessões",
  },
};

function outputWith(overrides: Partial<AnalysisOutput> = {}): AnalysisOutput {
  return {
    thesis: "PETR4 em R$ 31,20 fica acima do break-even de R$ 30,15 até 16/11/2026.",
    counterThesis: "Uma queda abaixo de R$ 30,15 leva a perda até R$ 1.234,56.",
    keyRisks: ["A taxa livre de risco de 10,65% a.a. pesa no carrego."],
    maxLoss: "A perda máxima é de R$ 1.234,56, limitada.",
    breakEvens: "Um único break-even, em R$ 30,15.",
    invalidation: ["Fechamento abaixo de R$ 30,15."],
    confidence: { level: "medium", justification: "Faltam 28 sessões e o delta é 0,45." },
    inputsCited: ["pricing.maxLoss", "pricing.breakEvens.0", "pricing.legs.0.delta"],
    ...overrides,
  };
}

describe("figuresIn", () => {
  it("reads pt-BR money, percentages and dates as figures", () => {
    expect(figuresIn("−R$ 1.234,56 e 2,08% em 17/10/2026").map((figure) => figure.text)).toEqual([
      "1.234,56",
      "2,08",
      "17/10/2026",
    ]);
  });

  it("treats digits glued to letters as names, not figures", () => {
    expect(figuresIn("PETR4, BOVA11, B3 e PETRK320")).toEqual([]);
  });

  it("ends a figure at its last digit, not at trailing punctuation", () => {
    expect(figuresIn("perda de R$ 500,00.").map((figure) => figure.text)).toEqual(["500,00"]);
  });

  it("splits a partial date into its parts", () => {
    expect(figuresIn("em 17/10").map((figure) => figure.text)).toEqual(["17", "10"]);
  });
});

describe("factAt", () => {
  it("resolves a leaf, a list index and an inner node", () => {
    expect(factAt(inputs.facts, "pricing.legs.0.strike")).toBe("R$ 32,00");
    expect(factAt(inputs.facts, "pricing.breakEvens")).toEqual(["R$ 30,15"]);
  });

  it("resolves a null fact as null, not as missing", () => {
    expect(factAt({ rule: null }, "rule")).toBeNull();
    expect(factAt({ rule: null }, "rule.kind")).toBeUndefined();
  });

  it("does not resolve past a string, out of range or by a non-numeric index", () => {
    expect(factAt(inputs.facts, "underlying.length")).toBeUndefined();
    expect(factAt(inputs.facts, "pricing.legs.9")).toBeUndefined();
    expect(factAt(inputs.facts, "pricing.legs.first")).toBeUndefined();
  });
});

describe("checkAnalysisCitations", () => {
  it("accepts a reply whose figures and paths all come from the facts", () => {
    expect(checkAnalysisCitations(inputs, outputWith())).toEqual({ ok: true });
  });

  it("accepts a figure by absolute value and with trailing zeros dropped", () => {
    const output = outputWith({ maxLoss: "Perda de −R$ 1.234,560 no pior caso." });
    expect(checkAnalysisCitations(inputs, output)).toEqual({ ok: true });
  });

  it("rejects a figure the facts do not hold", () => {
    const output = outputWith({ thesis: "O alvo é R$ 35,00." });
    expect(checkAnalysisCitations(inputs, output)).toEqual({
      ok: false,
      uncitedFigures: ["35,00"],
      unknownPaths: [],
    });
  });

  it("rejects a figure the model derived, even from facts it holds", () => {
    const output = outputWith({ keyRisks: ["O delta de 45% concentra o risco."] });
    expect(checkAnalysisCitations(inputs, output)).toMatchObject({
      ok: false,
      uncitedFigures: ["45"],
    });
  });

  it("rejects a date the facts do not hold", () => {
    const output = outputWith({ invalidation: ["Fechamento abaixo de R$ 30,15 até 01/11/2026."] });
    expect(checkAnalysisCitations(inputs, output)).toMatchObject({
      ok: false,
      uncitedFigures: ["01/11/2026"],
    });
  });

  it("rejects a standalone year or count the facts do not hold", () => {
    const output = outputWith({ thesis: "Em 2026 há 3 cenários." });
    expect(checkAnalysisCitations(inputs, output)).toMatchObject({
      ok: false,
      uncitedFigures: ["2026", "3"],
    });
  });

  it("rejects a malformed figure instead of ignoring it", () => {
    const output = outputWith({ thesis: "Algo em 1,2,3." });
    expect(checkAnalysisCitations(inputs, output)).toMatchObject({
      ok: false,
      uncitedFigures: ["1,2,3"],
    });
  });

  it("accepts an en reading of a pt-BR-ambiguous figure only when the facts hold it", () => {
    const facts = { ...inputs, facts: { ...inputs.facts, exposure: "1.5" } };
    expect(checkAnalysisCitations(facts, outputWith({ thesis: "Exposição de 1.5." }))).toEqual({
      ok: true,
    });
    expect(
      checkAnalysisCitations(inputs, outputWith({ thesis: "Exposição de 1.234." })),
    ).toMatchObject({ ok: false, uncitedFigures: ["1.234"] });
  });

  it("rejects cited paths that name no fact", () => {
    const output = outputWith({
      inputsCited: ["pricing.maxLoss", "pricing.legs.1.delta", "pricing.legs.x", "user.email"],
    });
    expect(checkAnalysisCitations(inputs, output)).toEqual({
      ok: false,
      uncitedFigures: [],
      unknownPaths: ["pricing.legs.1.delta", "pricing.legs.x", "user.email"],
    });
  });

  it("does not resolve a path through an inherited property", () => {
    const output = outputWith({ inputsCited: ["pricing.constructor", "__proto__"] });
    expect(checkAnalysisCitations(inputs, output)).toMatchObject({
      ok: false,
      unknownPaths: ["pricing.constructor", "__proto__"],
    });
  });
});

describe("analysisOutputSchema", () => {
  it("accepts the contract", () => {
    expect(analysisOutputSchema.safeParse(outputWith()).success).toBe(true);
  });

  it("refuses a numeric confidence", () => {
    const output = { ...outputWith(), confidence: { level: 0.7, justification: "x" } };
    expect(analysisOutputSchema.safeParse(output).success).toBe(false);
  });

  it("refuses fields outside the contract", () => {
    expect(analysisOutputSchema.safeParse({ ...outputWith(), price: "R$ 10,00" }).success).toBe(
      false,
    );
  });

  it("refuses an empty list of risks or of cited inputs", () => {
    expect(analysisOutputSchema.safeParse(outputWith({ keyRisks: [] })).success).toBe(false);
    expect(analysisOutputSchema.safeParse(outputWith({ inputsCited: [] })).success).toBe(false);
  });
});

describe("analysisInputsSchema", () => {
  it("accepts display-string facts", () => {
    expect(analysisInputsSchema.safeParse(inputs).success).toBe(true);
  });

  it("refuses raw numbers as facts", () => {
    const raw = { subject: "signal", facts: { maxLoss: 123456 } };
    expect(analysisInputsSchema.safeParse(raw).success).toBe(false);
  });

  it("refuses keys a citation path could not name", () => {
    expect(
      analysisInputsSchema.safeParse({ subject: "signal", facts: { "a.b": "1" } }).success,
    ).toBe(false);
    expect(
      analysisInputsSchema.safeParse({ subject: "signal", facts: { __proto__x: "1" } }).success,
    ).toBe(false);
  });

  it("refuses facts nested deeper than MAX_FACT_DEPTH", () => {
    let deep: AnalysisFact = "1";
    for (let level = 0; level < 21; level += 1) deep = { a: deep };
    expect(analysisInputsSchema.safeParse({ subject: "signal", facts: deep }).success).toBe(false);
    expect(analysisInputsSchema.safeParse({ subject: "signal", facts: { a: "1" } }).success).toBe(
      true,
    );
  });
});
