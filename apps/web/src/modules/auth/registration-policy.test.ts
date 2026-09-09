import { describe, expect, it } from "vitest";

import { evaluateRegistrationMode } from "./registration-policy";

describe("evaluateRegistrationMode", () => {
  it("allows sign-up in open mode regardless of an invite", () => {
    expect(evaluateRegistrationMode("open", false)).toEqual({ allowed: true });
    expect(evaluateRegistrationMode("open", true)).toEqual({ allowed: true });
  });

  it("refuses sign-up in closed mode regardless of an invite", () => {
    expect(evaluateRegistrationMode("closed", false)).toEqual({
      allowed: false,
      reason: "registration_closed",
    });
    expect(evaluateRegistrationMode("closed", true)).toEqual({
      allowed: false,
      reason: "registration_closed",
    });
  });

  it("allows sign-up in invite mode only with a pending invite", () => {
    expect(evaluateRegistrationMode("invite", true)).toEqual({ allowed: true });
    expect(evaluateRegistrationMode("invite", false)).toEqual({
      allowed: false,
      reason: "invite_required",
    });
  });
});
