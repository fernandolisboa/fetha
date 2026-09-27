import { describe, expect, it } from "vitest";

import { CURRENT_TERMS_VERSION } from "./terms";
import { classifyTermsVersion } from "./terms-gate";

describe("classifyTermsVersion", () => {
  it("is current for the current version", () => {
    expect(classifyTermsVersion(CURRENT_TERMS_VERSION)).toEqual({ state: "current" });
  });

  it("is stale for an older, non-null version", () => {
    expect(classifyTermsVersion("2020-01-01.1")).toEqual({ state: "stale" });
  });

  it("is unconfirmed for a NULL version", () => {
    expect(classifyTermsVersion(null)).toEqual({ state: "unconfirmed" });
  });

  it("does not treat a lexicographically later fake version as current (equality, not recency)", () => {
    expect(classifyTermsVersion("9999-99-99.9")).toEqual({ state: "stale" });
  });
});
