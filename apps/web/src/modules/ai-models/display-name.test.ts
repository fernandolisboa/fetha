import { describe, expect, it } from "vitest";

import { modelDisplayName } from "./display-name";

describe("modelDisplayName", () => {
  it("names a major.minor id", () => {
    expect(modelDisplayName("claude-opus-5-5")).toBe("Claude Opus 5.5");
  });

  it("names a bare major id", () => {
    expect(modelDisplayName("claude-opus-6")).toBe("Claude Opus 6");
  });

  it("names haiku and sonnet the same way", () => {
    expect(modelDisplayName("claude-haiku-5-5")).toBe("Claude Haiku 5.5");
    expect(modelDisplayName("claude-sonnet-5-5")).toBe("Claude Sonnet 5.5");
  });

  it("names a dated snapshot like its undated version", () => {
    expect(modelDisplayName("claude-opus-5-5-20260815")).toBe("Claude Opus 5.5");
  });

  it("falls back to the raw id for anything that does not parse", () => {
    expect(modelDisplayName("fable-6")).toBe("fable-6");
  });
});
