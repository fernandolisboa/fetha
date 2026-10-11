import { describe, expect, it } from "vitest";

import { analysisModelDisplayName } from "./analysis-model-name";

describe("analysisModelDisplayName", () => {
  it("names the Opus model", () => {
    expect(analysisModelDisplayName("claude-opus-5-5")).toBe("Claude Opus 5.5");
  });

  it("names the Sonnet model", () => {
    expect(analysisModelDisplayName("claude-sonnet-5-5")).toBe("Claude Sonnet 5.5");
  });

  it("falls back to the raw id for an unknown model", () => {
    expect(analysisModelDisplayName("claude-haiku-5-5")).toBe("claude-haiku-5-5");
  });
});
