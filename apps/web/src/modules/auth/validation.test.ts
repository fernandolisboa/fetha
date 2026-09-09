import { describe, expect, it } from "vitest";

import { resendVerificationFormSchema, signInFormSchema, signUpFormSchema } from "./validation";

describe("signUpFormSchema", () => {
  it("normalizes the email to lowercase and trims it", () => {
    const parsed = signUpFormSchema.parse({
      name: "  Nova User  ",
      email: "  Nova@Example.com ",
      password: "correct-horse-battery",
      termsAccepted: true,
      privacyAccepted: true,
    });
    expect(parsed.email).toBe("nova@example.com");
    expect(parsed.name).toBe("Nova User");
  });

  it("rejects a password shorter than 8 characters", () => {
    const result = signUpFormSchema.safeParse({
      name: "Nova User",
      email: "nova@example.com",
      password: "short",
      termsAccepted: true,
      privacyAccepted: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = signUpFormSchema.safeParse({
      name: "Nova User",
      email: "not-an-email",
      password: "correct-horse-battery",
      termsAccepted: true,
      privacyAccepted: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("signInFormSchema", () => {
  it("accepts a valid email and non-empty password", () => {
    const result = signInFormSchema.safeParse({ email: "nova@example.com", password: "x" });
    expect(result.success).toBe(true);
  });
});

describe("resendVerificationFormSchema", () => {
  it("normalizes the email", () => {
    const parsed = resendVerificationFormSchema.parse({ email: "  Nova@Example.com " });
    expect(parsed.email).toBe("nova@example.com");
  });
});
