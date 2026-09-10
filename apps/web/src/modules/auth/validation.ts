import { z } from "zod";

import { normalizeEmail } from "./normalize-email";

export const emailField = z.string().transform(normalizeEmail).pipe(z.email());

export const signUpFormSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailField,
  password: z.string().min(8).max(128),
  termsAccepted: z.boolean(),
  privacyAccepted: z.boolean(),
});

export const signInFormSchema = z.object({
  email: emailField,
  password: z.string().min(1),
});

// resend verification, magic link and password reset requests all take
// nothing but an email; one schema, three names for readability at the call
// site.
const emailOnlyFormSchema = z.object({
  email: emailField,
});

export const resendVerificationFormSchema = emailOnlyFormSchema;
export const magicLinkFormSchema = emailOnlyFormSchema;
export const requestPasswordResetFormSchema = emailOnlyFormSchema;

export const resetPasswordFormSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

// The "check your email" screens read the address back from a query param
// to echo it in the confirmation copy; that param is attacker-controlled
// (it never round-trips through the server), so it is validated the same
// way any other email input is, and simply dropped when invalid rather than
// rendered.
export function parseEmailQueryParam(email: string | undefined): string | undefined {
  if (!email) {
    return undefined;
  }
  const parsed = emailField.safeParse(email);
  return parsed.success ? parsed.data : undefined;
}
