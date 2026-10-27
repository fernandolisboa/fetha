import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { researchCalibration } from "../research-calibration";
import type { ResearchScoreRow } from "../research-scores-repository";
import { ResearchCalibrationPanel } from "./research-calibration-panel";

const row = (
  verdict: ResearchScoreRow["verdict"],
  claimHeld: boolean | null,
  pnlCentavos: number | null,
): ResearchScoreRow => ({
  ideaId: crypto.randomUUID(),
  verdict,
  claimHeld,
  pnlCentavos,
  unscorableReason: pnlCentavos === null ? "insufficient_data" : null,
});

const render = (rows: ResearchScoreRow[]) =>
  renderToStaticMarkup(
    createElement(ResearchCalibrationPanel, { calibration: researchCalibration(rows) }),
  );

function textOf(html: string, testId: string): string {
  const match = new RegExp(`data-testid="${testId}"[^>]*>(.*?)</(?:tr|p)>`, "s").exec(html);
  return (match?.[1] ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

describe("ResearchCalibrationPanel", () => {
  const rows = [
    row("do_not_enter", true, 10000),
    row("do_not_enter", false, -4000),
    row("do_not_enter", null, null),
    row("enter", true, 700),
  ];

  it("shows the same per-lot average in the discarded row and in the sentence", () => {
    const html = render(rows);
    expect(textOf(html, "research-row-do_not_enter")).toContain("R$ 30,00");
    expect(textOf(html, "research-discarded-sentence")).toContain("R$ 30,00");
  });

  it("says how many ideas had no data and keeps them out of the average", () => {
    const html = render(rows);
    expect(textOf(html, "research-row-do_not_enter")).toContain("1 sem dados");
    expect(textOf(html, "research-row-do_not_enter")).toContain("2");
  });

  it("shows a dash, not zero, for a verdict with nothing scored", () => {
    expect(textOf(render(rows), "research-row-wait")).toContain("—");
  });

  it("is empty only when no idea reached its expiry at all", () => {
    expect(render([])).toContain("research-calibration-empty");
    expect(render([row("enter", null, null)])).toContain('data-testid="research-calibration"');
  });
});
