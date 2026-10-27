import { describe, expect, it } from "vitest";

import type { EngineResearchView, ObtainSuggestionsResult } from "./research-actions";
import { applyObtained, initialPanelState } from "./research-panel-state";
import type { ResearchView } from "./research-view";

const engine = { candidates: 2 } as unknown as EngineResearchView;
const stored = { id: "stored" } as unknown as ResearchView;
const fresh = { id: "fresh" } as unknown as ResearchView;

describe("initialPanelState", () => {
  it("starts with the stored research and no engine result", () => {
    expect(initialPanelState(stored)).toEqual({
      engine: null,
      research: stored,
      notice: null,
      error: null,
    });
  });
});

describe("applyObtained", () => {
  it("replaces the stored research with the new opinion", () => {
    const outcome: ObtainSuggestionsResult = {
      status: "ok",
      engine,
      research: fresh,
      notice: null,
    };
    expect(applyObtained(initialPanelState(stored), outcome)).toEqual({
      engine,
      research: fresh,
      notice: null,
      error: null,
    });
  });

  it("shows the engine's numbers with the notice, dropping the stored research", () => {
    const outcome: ObtainSuggestionsResult = {
      status: "ok",
      engine,
      research: null,
      notice: { kind: "no_key" },
    };
    expect(applyObtained(initialPanelState(stored), outcome)).toEqual({
      engine,
      research: null,
      notice: { kind: "no_key" },
      error: null,
    });
  });

  it("keeps the last good result and says what failed when the research did not run", () => {
    const shown = applyObtained(initialPanelState(null), {
      status: "ok",
      engine,
      research: fresh,
      notice: null,
    });
    expect(applyObtained(shown, { status: "error", error: "rate_limited" })).toEqual({
      ...shown,
      error: "rate_limited",
    });
  });

  it("clears an earlier error once a research runs", () => {
    const failed = applyObtained(initialPanelState(null), {
      status: "error",
      error: "unavailable",
    });
    expect(
      applyObtained(failed, { status: "ok", engine, research: null, notice: null }).error,
    ).toBeNull();
  });
});
