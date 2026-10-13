import { describe, expect, it } from "vitest";

import {
  analysisInputsSchema,
  analysisOutputSchema,
  analysisOutputV2Schema,
  analysisOutputV3Schema,
  checkAnalysisCitations,
  checkAnalysisVerdict,
  factAt,
  figuresIn,
  outlookOf,
  resolveAnalysisOutlook,
  storedAnalysisOutputSchema,
  verdictOf,
  type AnalysisFact,
  type AnalysisInputs,
  type AnalysisOutlook,
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

const heldInputs: AnalysisInputs = {
  subject: "held_operation",
  facts: {
    session: "09/10/2026",
    underlying: "ITUB4",
    expiry: "20/11/2026",
    legs: [{ ticker: "ITUBK360", entryPrice: "R$ 0,95" }],
    pricing: {
      spot: "R$ 35,80",
      maxLoss: "−R$ 10.452,00",
      maxGain: "R$ 348,00",
      breakEvens: ["R$ 34,84"],
      payoff: [{ underlying: "R$ 1.030,00", pnl: "R$ 0,00" }],
      riskFreeRate: "10,65% a.a.",
    },
  },
};

function outlookWith(overrides: Partial<AnalysisOutlook> = {}): AnalysisOutlook {
  return {
    instrumentFact: "underlying",
    direction: "above",
    levelFact: "pricing.breakEvens.0",
    horizon: "one_month",
    likelihood: "likely",
    ...overrides,
  };
}

describe("analysisOutputV2Schema", () => {
  it("accepts an outlook or null, and requires the field", () => {
    expect(
      analysisOutputV2Schema.safeParse({ ...outputWith(), outlook: outlookWith() }).success,
    ).toBe(true);
    expect(analysisOutputV2Schema.safeParse({ ...outputWith(), outlook: null }).success).toBe(true);
    expect(analysisOutputV2Schema.safeParse(outputWith()).success).toBe(false);
  });

  it("rejects a numeric likelihood and an unknown horizon", () => {
    expect(
      analysisOutputV2Schema.safeParse({
        ...outputWith(),
        outlook: { ...outlookWith(), likelihood: 0.8 },
      }).success,
    ).toBe(false);
    expect(
      analysisOutputV2Schema.safeParse({
        ...outputWith(),
        outlook: { ...outlookWith(), horizon: "2026-12-01" },
      }).success,
    ).toBe(false);
  });

  it("rejects an outlook that writes its level instead of naming a fact", () => {
    expect(
      analysisOutputV2Schema.safeParse({
        ...outputWith(),
        outlook: { ...outlookWith(), level: "34.84" },
      }).success,
    ).toBe(false);
  });
});

describe("storedAnalysisOutputSchema and outlookOf", () => {
  it("reads both released contracts back", () => {
    const v1 = storedAnalysisOutputSchema.parse(outputWith());
    const v2 = storedAnalysisOutputSchema.parse({ ...outputWith(), outlook: outlookWith() });
    expect(outlookOf(v1)).toBeNull();
    expect(outlookOf(v2)).toEqual(outlookWith());
  });
});

const verdict = {
  decision: "wait" as const,
  justification: "O preço de R$ 31,20 ainda não passou do break-even de R$ 30,15.",
};

describe("analysisOutputV3Schema", () => {
  it("accepts a verdict or null, and requires the field", () => {
    const v2 = { ...outputWith(), outlook: null };
    expect(analysisOutputV3Schema.safeParse({ ...v2, verdict }).success).toBe(true);
    expect(analysisOutputV3Schema.safeParse({ ...v2, verdict: null }).success).toBe(true);
    expect(analysisOutputV3Schema.safeParse(v2).success).toBe(false);
  });

  it("takes the verdict only from the closed list, never as a number", () => {
    const v2 = { ...outputWith(), outlook: null };
    expect(
      analysisOutputV3Schema.safeParse({ ...v2, verdict: { ...verdict, decision: "buy" } }).success,
    ).toBe(false);
    expect(
      analysisOutputV3Schema.safeParse({ ...v2, verdict: { ...verdict, decision: 1 } }).success,
    ).toBe(false);
  });

  it("checks the verdict's justification against the facts like any other prose", () => {
    const output = { ...outputWith(), outlook: null, verdict };
    expect(checkAnalysisCitations(inputs, output)).toEqual({ ok: true });
    expect(
      checkAnalysisCitations(inputs, {
        ...output,
        verdict: { decision: "enter", justification: "Entre até R$ 29,00." },
      }),
    ).toEqual({ ok: false, uncitedFigures: ["29,00"], unknownPaths: [] });
  });
});

describe("checkAnalysisVerdict", () => {
  const v3 = { ...outputWith(), outlook: null };

  it("requires a verdict for a suggestion", () => {
    expect(checkAnalysisVerdict("suggestion", { ...v3, verdict })).toEqual({ ok: true });
    expect(checkAnalysisVerdict("suggestion", { ...v3, verdict: null })).toEqual({
      ok: false,
      problem: "missing",
    });
  });

  it("refuses a verdict on every other subject", () => {
    for (const subject of [
      "signal",
      "contemplated_operation",
      "held_operation",
      "backtest_run",
    ] as const) {
      expect(checkAnalysisVerdict(subject, { ...v3, verdict: null })).toEqual({ ok: true });
      expect(checkAnalysisVerdict(subject, { ...v3, verdict })).toEqual({
        ok: false,
        problem: "unexpected",
      });
    }
  });
});

describe("verdictOf", () => {
  it("reads the verdict of an analysis@3 reply and null for older ones", () => {
    const v3 = storedAnalysisOutputSchema.parse({ ...outputWith(), outlook: null, verdict });
    const v2 = storedAnalysisOutputSchema.parse({ ...outputWith(), outlook: outlookWith() });
    expect(verdictOf(v3)).toEqual(verdict);
    expect(verdictOf(v2)).toBeNull();
    expect(verdictOf(storedAnalysisOutputSchema.parse(outputWith()))).toBeNull();
  });
});

describe("resolveAnalysisOutlook", () => {
  it("turns the named facts into a claim, a fixed confidence and a session count", () => {
    expect(resolveAnalysisOutlook(heldInputs, outlookWith())).toEqual({
      ok: true,
      claim: { kind: "close_above", instrument: "ITUB4", level: "34.84" },
      confidence: "0.75",
      horizon: { kind: "sessions", count: 21 },
    });
  });

  it("maps every horizon and likelihood by its table", () => {
    const week = resolveAnalysisOutlook(
      heldInputs,
      outlookWith({ horizon: "one_week", likelihood: "somewhat_likely", direction: "below" }),
    );
    expect(week).toMatchObject({
      claim: { kind: "close_below" },
      confidence: "0.6",
      horizon: { kind: "sessions", count: 5 },
    });
    expect(
      resolveAnalysisOutlook(
        heldInputs,
        outlookWith({ horizon: "three_months", likelihood: "very_likely" }),
      ),
    ).toMatchObject({ confidence: "0.9", horizon: { kind: "sessions", count: 63 } });
  });

  it("reads a thousands-separated price and an expiry after the session", () => {
    expect(
      resolveAnalysisOutlook(
        heldInputs,
        outlookWith({ levelFact: "pricing.payoff.0.underlying", horizon: "expiry" }),
      ),
    ).toMatchObject({
      claim: { level: "1030" },
      horizon: { kind: "expiry", expiry: "2026-11-20" },
    });
  });

  it.each([
    ["a missing path", { instrumentFact: "user.email" }],
    ["a price, not a ticker", { instrumentFact: "pricing.spot" }],
    ["a ticker list, not a ticker", { instrumentFact: "legs" }],
    ["an option leg, not the subject's ticker", { instrumentFact: "legs.0.ticker" }],
  ])("refuses an instrument fact that is %s", (_, overrides) => {
    expect(resolveAnalysisOutlook(heldInputs, outlookWith(overrides))).toEqual({
      ok: false,
      problem: "instrument_fact",
    });
  });

  it.each([
    ["a missing path", "pricing.target"],
    ["a negative amount", "pricing.maxLoss"],
    ["a rate", "pricing.riskFreeRate"],
    ["a zero amount", "pricing.payoff.0.pnl"],
    ["a ticker", "underlying"],
    ["an amount of money", "pricing.maxGain"],
    ["an option premium", "legs.0.entryPrice"],
  ])("refuses a level fact that is %s", (_, levelFact) => {
    expect(resolveAnalysisOutlook(heldInputs, outlookWith({ levelFact }))).toEqual({
      ok: false,
      problem: "level_fact",
    });
  });

  it("refuses expiry when the facts hold none, or none after their session", () => {
    expect(resolveAnalysisOutlook(inputs, outlookWith({ horizon: "expiry" }))).toEqual({
      ok: false,
      problem: "expiry_fact",
    });
    const expired: AnalysisInputs = {
      ...heldInputs,
      facts: { ...heldInputs.facts, expiry: "09/10/2026" },
    };
    expect(resolveAnalysisOutlook(expired, outlookWith({ horizon: "expiry" }))).toEqual({
      ok: false,
      problem: "expiry_fact",
    });
  });
});
