import { describe, expect, it } from "vitest";

import type { EngineResearchView, ObtainSuggestionsResult } from "./research-actions";
import { applyObtained, initialPanelState, withStored } from "./research-panel-state";
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

describe("withStored", () => {
  const unsentCard = { underlying: "PETR4" } as unknown as ResearchView["unsent"][number];
  const onScreen = {
    id: "fresh",
    unsent: [unsentCard],
    marker: "before",
  } as unknown as ResearchView;
  const revalidated = { id: "fresh", unsent: [], marker: "after" } as unknown as ResearchView;

  it("takes the revalidated research with the same id, keeping the unsent ideas on screen", () => {
    const previous = applyObtained(initialPanelState(null), {
      status: "ok",
      engine,
      research: onScreen,
      notice: null,
    });
    const next = withStored(previous, revalidated);
    expect(next.research).toEqual({ ...revalidated, unsent: [unsentCard] });
    expect(next.engine).toBe(engine);
    expect(next.notice).toBeNull();
    expect(next.error).toBeNull();
  });

  it("takes the stored research when none is on screen", () => {
    expect(withStored(initialPanelState(null), stored)).toEqual(initialPanelState(stored));
  });

  it("takes a different stored research as it is", () => {
    const next = withStored(initialPanelState(onScreen), stored);
    expect(next.research).toBe(stored);
  });

  it("leaves an engine-only result on screen, which is newer than any stored research", () => {
    const engineOnly = applyObtained(initialPanelState(stored), {
      status: "ok",
      engine,
      research: null,
      notice: { kind: "no_key" },
    });
    expect(withStored(engineOnly, stored)).toBe(engineOnly);
  });

  it("keeps what is on screen when nothing is stored any more", () => {
    const previous = initialPanelState(stored);
    expect(withStored(previous, null)).toBe(previous);
  });

  it("keeps the error and the notice", () => {
    const previous = {
      ...initialPanelState(onScreen),
      notice: { kind: "no_key" as const },
      error: "unavailable" as const,
    };
    const next = withStored(previous, revalidated);
    expect(next.notice).toEqual({ kind: "no_key" });
    expect(next.error).toBe("unavailable");
  });
});
