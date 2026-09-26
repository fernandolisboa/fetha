import { describe, expect, it } from "vitest";
import { evaluationReasons } from "@fetha/engine";

import { evaluationLabel, strategiesStrings, t } from "./strings";

const reasonsWithNoText = new Set(["signal", "conditions_not_met"]);

describe("evaluationLog.detailFor", () => {
  it("renders distinct text for each of the three failure codes introduced in evaluate-signals.ts (#19 round 3 item 7)", () => {
    const unknownStructure = t.inbox.evaluationLog.detailFor("unknown_structure");
    const unsatisfiableCollection = t.inbox.evaluationLog.detailFor(
      "unsatisfiable_collection:impliedVolatilityIndex",
    );
    const engineError = t.inbox.evaluationLog.detailFor("engine_error:bad_input");

    expect(unknownStructure).toBeDefined();
    expect(unsatisfiableCollection).toBeDefined();
    expect(engineError).toBeDefined();

    const rendered = new Set([unknownStructure, unsatisfiableCollection, engineError]);
    expect(rendered.size).toBe(3);
  });

  it("renders the engine error's own code inside the message, so two different codes read differently", () => {
    const first = t.inbox.evaluationLog.detailFor("engine_error:invalid_window");
    const second = t.inbox.evaluationLog.detailFor("engine_error:no_calendar");

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toBe(second);
  });

  it("renders the catch-up clamp's dropped-session count inside the message (#19 round 3 item 2)", () => {
    const clamped = t.inbox.evaluationLog.detailFor("catchup_clamped:8");
    expect(clamped).toContain("8");
  });

  it("falls back to undefined for a detail string outside the known vocabulary", () => {
    expect(t.inbox.evaluationLog.detailFor("something_unrecognized")).toBeUndefined();
  });

  it("renders the unaffordable-budget sizing detail distinctly from the zero-units one (#59)", () => {
    const zeroUnits = t.inbox.evaluationLog.detailFor(
      "a unit carries no cost or risk to size against",
    );
    const unaffordableBudget = t.inbox.evaluationLog.detailFor(
      "the declared capital and fraction cannot afford one unit",
    );

    expect(zeroUnits).toBeDefined();
    expect(unaffordableBudget).toBeDefined();
    expect(unaffordableBudget).not.toBe(zeroUnits);
  });

  it("keeps the pre-#59 sizing detail defined for evaluation records stored before the split", () => {
    expect(t.inbox.evaluationLog.detailFor("sizing yields fewer than one unit")).toBeDefined();
  });

  it("renders the same collection-neutral message regardless of which collection failed (#18 round 7 item 4)", () => {
    const ivRank = t.inbox.evaluationLog.detailFor(
      "unsatisfiable_collection:impliedVolatilityIndex",
    );
    const somethingElse = t.inbox.evaluationLog.detailFor("unsatisfiable_collection:quotes");

    expect(ivRank).toBeDefined();
    expect(ivRank).toBe(somethingElse);
    expect(ivRank?.toLowerCase()).not.toContain("implied volatility");
  });
});

describe("evaluationLog.reasonText (#80)", () => {
  it("translates every EvaluationReason code the engine declares, in both locales, except signal and conditions_not_met (which add nothing beyond the outcome label)", () => {
    for (const reason of evaluationReasons) {
      if (reasonsWithNoText.has(reason)) {
        expect(strategiesStrings.en.inbox.evaluationLog.reasonText[reason]).toBeNull();
        expect(strategiesStrings.ptBR.inbox.evaluationLog.reasonText[reason]).toBeNull();
        continue;
      }
      expect(strategiesStrings.en.inbox.evaluationLog.reasonText[reason]).toBeTruthy();
      expect(strategiesStrings.ptBR.inbox.evaluationLog.reasonText[reason]).toBeTruthy();
    }
  });

  it("renders distinct text for each code with a non-null text, per locale", () => {
    const enTexts = new Set(
      Object.values(strategiesStrings.en.inbox.evaluationLog.reasonText).filter(
        (text): text is string => text !== null,
      ),
    );
    const ptBRTexts = new Set(
      Object.values(strategiesStrings.ptBR.inbox.evaluationLog.reasonText).filter(
        (text): text is string => text !== null,
      ),
    );
    expect(enTexts.size).toBe(evaluationReasons.length - reasonsWithNoText.size);
    expect(ptBRTexts.size).toBe(evaluationReasons.length - reasonsWithNoText.size);
  });
});

describe("evaluationLabel", () => {
  it("renders just the outcome label when reason is signal", () => {
    expect(evaluationLabel({ outcome: "signal", reason: "signal", detail: null })).toBe(
      t.inbox.outcomes.signal,
    );
  });

  it("renders just the outcome label when reason is conditions_not_met", () => {
    expect(
      evaluationLabel({
        outcome: "conditions_not_met",
        reason: "conditions_not_met",
        detail: null,
      }),
    ).toBe(t.inbox.outcomes.conditions_not_met);
  });

  it("renders the outcome label followed by the reason text for a reason that adds information", () => {
    const reasonText = t.inbox.evaluationLog.reasonText.unaffordable_budget;
    expect(reasonText).toBeTruthy();
    expect(
      evaluationLabel({
        outcome: "unsizeable",
        reason: "unaffordable_budget",
        detail: "the declared capital and fraction cannot afford one unit",
      }),
    ).toBe(`${t.inbox.outcomes.unsizeable} · ${reasonText ?? ""}`);
  });

  it("falls back to the legacy detail string when reason is null and the detail is recognized", () => {
    const legacyText = t.inbox.evaluationLog.detail["no declared capital to size against"];
    expect(legacyText).toBeTruthy();
    expect(
      evaluationLabel({
        outcome: "unsizeable",
        reason: null,
        detail: "no declared capital to size against",
      }),
    ).toBe(`${t.inbox.outcomes.unsizeable} · ${legacyText ?? ""}`);
  });

  it("renders just the outcome label when reason is null and the detail is unrecognized", () => {
    expect(
      evaluationLabel({
        outcome: "insufficient_data",
        reason: null,
        detail: "something_unrecognized",
      }),
    ).toBe(t.inbox.outcomes.insufficient_data);
  });
});
