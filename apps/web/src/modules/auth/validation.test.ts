import { describe, expect, it } from "vitest";

import {
  magicLinkFormSchema,
  parseEmailQueryParam,
  requestPasswordResetFormSchema,
  resendVerificationFormSchema,
  resetPasswordFormSchema,
  signInFormSchema,
  signUpFormSchema,
} from "./validation";

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

  it.each([
    ["a line feed", "cliente.\n\nSua conta foi bloqueada"],
    ["a carriage return", "Nova\rUser"],
    ["a tab", "Nova\tUser"],
    ["a NUL", "Nova\u0000User"],
    ["a zero-width space", "Nova\u200bUser"],
    ["a line separator", "Nova\u2028Sua conta foi bloqueada"],
    ["a paragraph separator", "Nova\u2029User"],
    ["an http link", "Nova http://evil.example"],
    ["an https link", "regularize em HTTPS://evil.example"],
  ])("rejects a name with %s", (_label, name) => {
    const result = signUpFormSchema.safeParse({
      name,
      email: "nova@example.com",
      password: "correct-horse-battery",
      termsAccepted: true,
      privacyAccepted: true,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a name with accents, apostrophes and hyphens", () => {
    const result = signUpFormSchema.safeParse({
      name: "João D'Ávila-Souza",
      email: "nova@example.com",
      password: "correct-horse-battery",
      termsAccepted: true,
      privacyAccepted: true,
    });
    expect(result.success).toBe(true);
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

describe("magicLinkFormSchema", () => {
  it("normalizes the email", () => {
    const parsed = magicLinkFormSchema.parse({ email: "  Nova@Example.com " });
    expect(parsed.email).toBe("nova@example.com");
  });

  it("rejects an invalid email", () => {
    const result = magicLinkFormSchema.safeParse({ email: "not-an-email" });
    expect(result.success).toBe(false);
  });
});

describe("requestPasswordResetFormSchema", () => {
  it("normalizes the email", () => {
    const parsed = requestPasswordResetFormSchema.parse({ email: "  Nova@Example.com " });
    expect(parsed.email).toBe("nova@example.com");
  });
});

describe("resetPasswordFormSchema", () => {
  it("accepts a token and a password of at least 8 characters", () => {
    const result = resetPasswordFormSchema.safeParse({
      token: "abc123",
      newPassword: "correct-horse-battery",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a password shorter than 8 characters", () => {
    const result = resetPasswordFormSchema.safeParse({ token: "abc123", newPassword: "short" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty token", () => {
    const result = resetPasswordFormSchema.safeParse({
      token: "",
      newPassword: "correct-horse-battery",
    });
    expect(result.success).toBe(false);
  });
});

describe("parseEmailQueryParam", () => {
  it("returns undefined when the param is absent", () => {
    expect(parseEmailQueryParam(undefined)).toBeUndefined();
  });

  it("normalizes a valid email", () => {
    expect(parseEmailQueryParam("  Nova@Example.com ")).toBe("nova@example.com");
  });

  it("returns undefined for a value that is not an email", () => {
    expect(parseEmailQueryParam("<script>alert(1)</script>")).toBeUndefined();
  });

  it("drops an address longer than 254 characters", () => {
    const local = "a".repeat(64);
    const domain = `${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.com`;
    expect(parseEmailQueryParam(`${local}@${domain}`)).toBeUndefined();
    expect(parseEmailQueryParam(`${local}@${"b".repeat(63)}.com`)).toBe(
      `${local}@${"b".repeat(63)}.com`,
    );
  });
});
