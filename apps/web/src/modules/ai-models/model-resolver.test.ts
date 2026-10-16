import { describe, expect, it } from "vitest";

import { newestOfFamily, type CatalogModelInfo } from "./model-resolver";

function at(id: string, createdAt: string): CatalogModelInfo {
  return { id, createdAt: new Date(createdAt) };
}

describe("newestOfFamily", () => {
  it("picks a higher major version over the pinned one", () => {
    const models = [at("claude-opus-5-5", "2026-07-01"), at("claude-opus-6", "2026-11-01")];
    expect(newestOfFamily(models, "opus")).toBe("claude-opus-6");
  });

  it("picks a higher minor version within the same major", () => {
    const models = [at("claude-sonnet-5-5", "2026-07-01"), at("claude-sonnet-5-6", "2026-09-01")];
    expect(newestOfFamily(models, "sonnet")).toBe("claude-sonnet-5-6");
  });

  it("accepts a dated snapshot and compares it like its undated version", () => {
    const models = [at("claude-haiku-5-6-20260901", "2026-09-01")];
    expect(newestOfFamily(models, "haiku")).toBe("claude-haiku-5-6-20260901");
  });

  it("ignores models of a different family", () => {
    const models = [at("claude-opus-6", "2026-11-01")];
    expect(newestOfFamily(models, "sonnet")).toBe("claude-sonnet-5-5");
  });

  it("ignores models outside the three allowed families (Fable, Mythos, ...)", () => {
    const models = [at("fable-6", "2026-11-01"), at("mythos-3", "2026-11-01")];
    expect(newestOfFamily(models, "opus")).toBe("claude-opus-5-5");
  });

  it("falls back to pinned when nothing in the listing is newer", () => {
    const models = [at("claude-opus-5-4", "2026-01-01")];
    expect(newestOfFamily(models, "opus")).toBe("claude-opus-5-5");
  });

  it("never returns anything older than the pinned id", () => {
    const models = [at("claude-opus-4-5", "2030-01-01")];
    expect(newestOfFamily(models, "opus")).toBe("claude-opus-5-5");
  });

  it("falls back to pinned on an empty listing", () => {
    expect(newestOfFamily([], "opus")).toBe("claude-opus-5-5");
  });

  it("tiebreaks same version by newer createdAt", () => {
    const models = [
      at("claude-opus-5-5-20260601", "2026-06-01"),
      at("claude-opus-5-5-20260901", "2026-09-01"),
    ];
    expect(newestOfFamily(models, "opus")).toBe("claude-opus-5-5-20260901");
  });

  it("tiebreaks an equal version and createdAt in favor of the undated alias", () => {
    const models = [
      at("claude-opus-5-5-20260601", "2026-06-01"),
      at("claude-opus-5-5", "2026-06-01"),
    ];
    expect(newestOfFamily(models, "opus")).toBe("claude-opus-5-5");
  });
});
