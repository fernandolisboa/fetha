import { z } from "zod";

import { normalizeEmail } from "./normalize-email";

const emailField = z.string().transform(normalizeEmail).pipe(z.email());

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

export const resendVerificationFormSchema = z.object({
  email: emailField,
});

export const magicLinkFormSchema = z.object({
  email: emailField,
});

export const requestPasswordResetFormSchema = z.object({
  email: emailField,
});

export const resetPasswordFormSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
