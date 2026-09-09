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
