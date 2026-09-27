import { describe, expect, it } from "vitest";

import {
  acceptTermsFormSchema,
  magicLinkFormSchema,
  parseEmailQueryParam,
  requestPasswordResetFormSchema,
  resendVerificationFormSchema,
  resetPasswordFormSchema,
  setPasswordFormSchema,
  signInFormSchema,
  signUpFormSchema,
} from "./validation";

describe("signUpFormSchema", () => {
  it("normalizes the email to lowercase and trims it", () => {
    const parsed = signUpFormSchema.parse({
      name: "  Nova User  ",
      email: "  Nova@Example.com ",
      termsAccepted: true,
      privacyAccepted: true,
    });
    expect(parsed.email).toBe("nova@example.com");
    expect(parsed.name).toBe("Nova User");
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
      termsAccepted: true,
      privacyAccepted: true,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a name with accents, apostrophes and hyphens", () => {
    const result = signUpFormSchema.safeParse({
      name: "João D'Ávila-Souza",
      email: "nova@example.com",
      termsAccepted: true,
      privacyAccepted: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = signUpFormSchema.safeParse({
      name: "Nova User",
      email: "not-an-email",
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

describe("setPasswordFormSchema", () => {
  it("accepts a password of 8 to 128 characters", () => {
    expect(setPasswordFormSchema.safeParse({ newPassword: "12345678" }).success).toBe(true);
    expect(setPasswordFormSchema.safeParse({ newPassword: "x".repeat(128) }).success).toBe(true);
  });

  it("rejects a password shorter than 8 or longer than 128 characters", () => {
    expect(setPasswordFormSchema.safeParse({ newPassword: "short" }).success).toBe(false);
    expect(setPasswordFormSchema.safeParse({ newPassword: "x".repeat(129) }).success).toBe(false);
  });
});

describe("acceptTermsFormSchema", () => {
  it("accepts both checkboxes with no name", () => {
    const result = acceptTermsFormSchema.safeParse({
      termsAccepted: true,
      privacyAccepted: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a name and trims it", () => {
    const parsed = acceptTermsFormSchema.parse({
      name: "  Nova User  ",
      termsAccepted: true,
      privacyAccepted: true,
    });
    expect(parsed.name).toBe("Nova User");
  });

  it("rejects an invalid name when one is given", () => {
    const result = acceptTermsFormSchema.safeParse({
      name: "Nova http://evil.example",
      termsAccepted: true,
      privacyAccepted: true,
    });
    expect(result.success).toBe(false);
  });

  it("parses unchecked boxes as false rather than failing", () => {
    const parsed = acceptTermsFormSchema.parse({ termsAccepted: false, privacyAccepted: false });
    expect(parsed.termsAccepted).toBe(false);
    expect(parsed.privacyAccepted).toBe(false);
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
