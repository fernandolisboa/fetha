import { describe, expect, it } from "vitest";
import {
  confidenceSchema,
  decimalStringSchema,
  type AnalysisInputs,
  type AnalysisOutput,
  type AnalysisOutputV2,
} from "@fetha/contracts";

import type { JournalAnalysis } from "../analyses-repository";

import { analysisOrigin, outlookSentence } from "./analysis-journal-item";
import { panelOutlookSentence } from "./analysis-panel";

const v1Output: AnalysisOutput = {
  thesis: "tese",
  counterThesis: "contratese",
  keyRisks: ["risco"],
  maxLoss: "perda",
  breakEvens: "equilíbrio",
  invalidation: ["condição"],
  confidence: { level: "medium", justification: "justificativa" },
  inputsCited: ["underlying"],
};

const v2Output: AnalysisOutputV2 = {
  ...v1Output,
  outlook: {
    instrumentFact: "underlying",
    direction: "above",
    levelFact: "pricing.breakEvens.0",
    horizon: "expiry",
    likelihood: "likely",
  },
};

const heldInputs: AnalysisInputs = {
  subject: "held_operation",
  facts: { underlying: "ITUB4", pricing: { breakEvens: ["R$ 34,84"] } },
};

function analysis(overrides: Partial<JournalAnalysis>): JournalAnalysis {
  return {
    inputs: heldInputs,
    output: v2Output,
    claim: {
      claim: {
        kind: "close_above",
        instrument: "ITUB4",
        level: decimalStringSchema.parse("34.84"),
      },
      confidence: confidenceSchema.parse("0.75"),
      horizon: "2026-11-20",
    },
    ...overrides,
  } as JournalAnalysis;
}

describe("analysisOrigin", () => {
  it.each([
    [{ subject: "signal", facts: { ticker: "VALE3" } }, "Sinal · VALE3"],
    [
      {
        subject: "contemplated_operation",
        facts: { structure: "Trava de alta", underlying: "PETR4" },
      },
      "Trava de alta · PETR4",
    ],
    [heldInputs, "Operação em carteira · ITUB4"],
    [
      { subject: "backtest_run", facts: { period: { from: "02/01/2024", to: "30/09/2026" } } },
      "Backtest · 02/01/2024 a 30/09/2026",
    ],
  ] as [AnalysisInputs, string][])("names the subject from its facts", (inputs, expected) => {
    expect(analysisOrigin({ inputs })).toBe(expected);
  });
});

describe("outlookSentence", () => {
  it("states the resolved claim with its horizon date", () => {
    expect(outlookSentence(analysis({}))).toBe(
      "ITUB4 fecha acima de R$ 34,84 no vencimento (20/11/2026)",
    );
  });

  it("has no line for an analysis@1 reply, which was never asked for an outlook", () => {
    expect(outlookSentence(analysis({ output: v1Output, claim: null }))).toBeNull();
  });

  it("says when a reply chose no outlook", () => {
    expect(outlookSentence(analysis({ output: { ...v2Output, outlook: null }, claim: null }))).toBe(
      "Sem previsão verificável",
    );
  });

  it("says when the outlook could not be placed on the calendar", () => {
    expect(outlookSentence(analysis({ claim: null }))).toBe(
      "A previsão não coube no calendário de pregões",
    );
  });
});

describe("panelOutlookSentence", () => {
  const base = { model: "claude-opus-5-5", promptVersion: "analysis@2", requestedAt: new Date() };

  it("reads the instrument and level from the facts its paths name", () => {
    expect(panelOutlookSentence({ ...base, inputs: heldInputs, output: v2Output })).toBe(
      "ITUB4 fecha acima de R$ 34,84 no vencimento · Provável",
    );
  });

  it("shows no outlook section for an analysis@1 reply", () => {
    expect(panelOutlookSentence({ ...base, inputs: heldInputs, output: v1Output })).toBeNull();
  });
});
