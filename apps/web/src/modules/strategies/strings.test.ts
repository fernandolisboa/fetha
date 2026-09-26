import { describe, expect, it } from "vitest";

import { t } from "./strings";

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
