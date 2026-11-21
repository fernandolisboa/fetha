import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./plan-adjuster", () => ({ PlanAdjuster: () => null }));

import type { BuildPlanActionInput, BuildPlanOutcome } from "../actions";
import { PlanScreen } from "./plan-screen";

function outcome(structureId: string): Extract<BuildPlanOutcome, { status: "ok" }> {
  return {
    status: "ok",
    plan: { structureId, summary: "Resumo do plano." } as unknown as Extract<
      BuildPlanOutcome,
      { status: "ok" }
    >["plan"],
    seriesByTicker: {},
    fingerprint: "fp",
    riskLimitCentavos: 10000,
    chain: [],
    expiryOptions: [],
    preview: {} as unknown as Extract<BuildPlanOutcome, { status: "ok" }>["preview"],
    structure: { id: structureId } as unknown as Extract<
      BuildPlanOutcome,
      { status: "ok" }
    >["structure"],
  };
}

function render(structureId: string): string {
  return renderToStaticMarkup(
    createElement(PlanScreen, {
      outcome: outcome(structureId),
      riskLimitCentavos: 10000,
      input: {} as unknown as BuildPlanActionInput,
    }),
  );
}

describe("PlanScreen", () => {
  it("links to the matching lesson", () => {
    const html = render("bull-call-spread");

    expect(html).toContain('href="/aprender/bull-call-spread"');
    expect(html).toContain("Aprender:");
  });

  it("leaves out the lesson link for a structure with no lesson", () => {
    const html = render("unknown-structure");

    expect(html).not.toContain("/aprender/");
  });
});
