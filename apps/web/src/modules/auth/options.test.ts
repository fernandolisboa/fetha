import { describe, expect, it } from "vitest";

import { buildUserCreateOverrides } from "./options";
import { CURRENT_TERMS_VERSION } from "./terms";

describe("buildUserCreateOverrides", () => {
  it("stamps the current terms version and acceptance timestamp on every user creation", () => {
    const acceptedAt = new Date("2026-09-09T12:00:00.000Z");
    const overrides = buildUserCreateOverrides({ email: "New.User@Example.com" }, acceptedAt);

    expect(overrides).toEqual({
      termsVersion: CURRENT_TERMS_VERSION,
      termsAcceptedAt: acceptedAt,
      email: "new.user@example.com",
    });
  });

  it("never omits termsVersion, so the merged create data can never produce a null column", () => {
    const overrides = buildUserCreateOverrides({ email: "a@example.com" });
    expect(overrides.termsVersion).toBe(CURRENT_TERMS_VERSION);
    expect(overrides.termsAcceptedAt).toBeInstanceOf(Date);
  });
});
