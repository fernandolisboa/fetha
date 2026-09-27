import { describe, expect, it } from "vitest";

import { CURRENT_TERMS_VERSION } from "./terms";
import { isCurrentTermsVersion } from "./terms-gate";

describe("isCurrentTermsVersion", () => {
  it("is true for the current version", () => {
    expect(isCurrentTermsVersion(CURRENT_TERMS_VERSION)).toBe(true);
  });

  it("is false for an older version", () => {
    expect(isCurrentTermsVersion("2020-01-01.1")).toBe(false);
  });

  it("is false for a NULL version", () => {
    expect(isCurrentTermsVersion(null)).toBe(false);
  });
});
