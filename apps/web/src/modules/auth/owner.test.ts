import { describe, expect, it } from "vitest";

import { isOwnerEmail } from "./owner";

const env = { OWNER_EMAILS: "owner@example.com" };

describe("isOwnerEmail", () => {
  it("is false when there is no candidate", () => {
    expect(isOwnerEmail(null, env)).toBe(false);
  });

  it("is false when the email is unverified, even if it is on the allowlist", () => {
    expect(isOwnerEmail({ email: "owner@example.com", emailVerified: false }, env)).toBe(false);
  });

  it("is false when the verified email is not on the allowlist", () => {
    expect(isOwnerEmail({ email: "someone-else@example.com", emailVerified: true }, env)).toBe(
      false,
    );
  });

  it("is true for a verified email on the allowlist, case-insensitively", () => {
    expect(isOwnerEmail({ email: "Owner@Example.com", emailVerified: true }, env)).toBe(true);
  });

  it("is false for everybody when OWNER_EMAILS is unset", () => {
    expect(isOwnerEmail({ email: "owner@example.com", emailVerified: true }, {})).toBe(false);
  });
});
