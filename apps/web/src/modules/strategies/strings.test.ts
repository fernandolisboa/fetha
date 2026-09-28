import { describe, expect, it } from "vitest";
import { evaluationReasons } from "@fetha/engine";

import { webEvaluationReasons } from "./evaluation-vocabulary";
import { MAX_VERSIONS_PER_STRATEGY } from "./strategies-repository";
import { evaluationLabel, strategiesStrings, t } from "./strings";

const reasonsWithNoText = new Set(["signal", "conditions_not_met"]);

describe("evaluationLog.webReasonText (#133)", () => {
  it("renders distinct text for each web-authored code", () => {
    const rendered = new Set(
      webEvaluationReasons.map((reason) => t.inbox.evaluationLog.webReasonText[reason]("8")),
    );
    expect(rendered.size).toBe(webEvaluationReasons.length);
  });

  it("renders the engine error's own code inside the message, so two different codes read differently", () => {
    const first = t.inbox.evaluationLog.webReasonText.engine_error("invalid_window");
    const second = t.inbox.evaluationLog.webReasonText.engine_error("no_calendar");

    expect(first).not.toBe(second);
  });

  it("renders the catch-up clamp's dropped-session count inside the message (#19)", () => {
    const clamped = t.inbox.evaluationLog.webReasonText.catchup_clamped("8");
    expect(clamped).toContain("8");
  });

  it("renders the same collection-neutral message regardless of which collection failed (#18)", () => {
    const ivRank =
      t.inbox.evaluationLog.webReasonText.unsatisfiable_collection("impliedVolatilityIndex");
    const somethingElse = t.inbox.evaluationLog.webReasonText.unsatisfiable_collection("quotes");

    expect(ivRank).toBe(somethingElse);
    expect(ivRank.toLowerCase()).not.toContain("implied volatility");
  });

  it("declares every web-authored reason for both locales", () => {
    for (const reason of webEvaluationReasons) {
      expect(strategiesStrings.en.inbox.evaluationLog.webReasonText[reason]).toBeTypeOf("function");
      expect(strategiesStrings.ptBR.inbox.evaluationLog.webReasonText[reason]).toBeTypeOf(
        "function",
      );
    }
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

  it("renders the outcome label followed by the reason text for an engine reason that adds information", () => {
    const reasonText = t.inbox.evaluationLog.reasonText.unaffordable_budget;
    expect(reasonText).toBeTruthy();
    expect(
      evaluationLabel({
        outcome: "unsizeable",
        reason: "unaffordable_budget",
        detail: null,
      }),
    ).toBe(`${t.inbox.outcomes.unsizeable} · ${reasonText ?? ""}`);
  });

  it("renders the outcome label followed by the web reason text, fed the row's own detail parameter", () => {
    const expected = t.inbox.evaluationLog.webReasonText.engine_error("unsizeable");
    expect(
      evaluationLabel({
        outcome: "insufficient_data",
        reason: "engine_error",
        detail: "unsizeable",
      }),
    ).toBe(`${t.inbox.outcomes.insufficient_data} · ${expected}`);
  });

  it("renders the outcome label followed by the web reason text for a code with no parameter", () => {
    const expected = t.inbox.evaluationLog.webReasonText.unknown_structure(null);
    expect(
      evaluationLabel({
        outcome: "insufficient_data",
        reason: "unknown_structure",
        detail: null,
      }),
    ).toBe(`${t.inbox.outcomes.insufficient_data} · ${expected}`);
  });

  it("renders just the outcome label when reason is null (pre-#80 row, no legacy fallback anymore)", () => {
    expect(
      evaluationLabel({
        outcome: "insufficient_data",
        reason: null,
        detail: "no declared capital to size against",
      }),
    ).toBe(t.inbox.outcomes.insufficient_data);
  });
});

describe("editor.errors.version_limit", () => {
  it("states the cap the repository enforces", () => {
    const cap = `${String(MAX_VERSIONS_PER_STRATEGY)} vers`;
    expect(strategiesStrings.en.editor.errors.version_limit).toContain(cap);
    expect(strategiesStrings.ptBR.editor.errors.version_limit).toContain(cap);
  });
});

describe("row-action aria-labels", () => {
  it.each([
    ["en", strategiesStrings.en],
    ["ptBR", strategiesStrings.ptBR],
  ] as const)("name the strategy and start with the visible verb (%s)", (_locale, strings) => {
    const name = "Trava de alta PETR4";
    const cases = [
      [strings.list.mine.shareAriaLabel(name), strings.list.mine.share],
      [strings.list.mine.unshareAriaLabel(name), strings.list.mine.unshare],
      [strings.list.shared.copyAriaLabel(name), strings.list.shared.copy],
      [strings.list.mine.archiveAriaLabel(name), strings.list.mine.archive],
      [strings.list.archived.unarchiveAriaLabel(name), strings.list.archived.unarchive],
    ] as const;
    for (const [label, visible] of cases) {
      expect(label.startsWith(visible)).toBe(true);
      expect(label).toContain(name);
    }
  });
});
