"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getDb } from "@/db/client";

import type { ActionState } from "./action-state";
import { createInvite } from "./invite-repository";
import { requireUser } from "./session";
import { resendVerification, signIn, signOut, signUp } from "./service";
import { t } from "./strings";
import { resendVerificationFormSchema, signInFormSchema, signUpFormSchema } from "./validation";

const createInviteFormSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

// Requires an authenticated session: with `REGISTRATION_MODE=invite`, only an
// existing user can extend an invite to the next one; the very first invite
// is seeded directly (see scripts/seed-invite.mjs).
export async function createInviteAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();

  const parsed = createInviteFormSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { status: "error", message: t.errors.invalidInput };
  }

  await createInvite(getDb(), parsed.data.email);
  return { status: "success", message: "Convite criado." };
}

export async function signUpAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const errors = t.errors;

  const parsed = signUpFormSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    termsAccepted: formData.get("termsAccepted") !== null,
    privacyAccepted: formData.get("privacyAccepted") !== null,
  });

  if (!parsed.success) {
    return { status: "error", message: errors.invalidInput };
  }

  if (!parsed.data.termsAccepted || !parsed.data.privacyAccepted) {
    return { status: "error", message: errors.termsRequired };
  }

  const requestHeaders = await headers();
  const outcome = await signUp(
    {
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
      termsAccepted: true,
    },
    requestHeaders,
  );

  switch (outcome.status) {
    case "ok":
      redirect(`/verificar-email?email=${encodeURIComponent(parsed.data.email)}`);
    case "terms_not_accepted":
      return { status: "error", message: errors.termsRequired };
    case "registration_closed":
      return { status: "error", message: errors.registrationClosed };
    case "invite_required":
      return { status: "error", message: errors.inviteRequired };
    case "sign_up_failed":
      return { status: "error", message: errors.signUpFailed };
  }
}

export async function signInAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const errors = t.errors;

  const parsed = signInFormSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { status: "error", message: errors.invalidInput };
  }

  const requestHeaders = await headers();
  const outcome = await signIn(parsed.data, requestHeaders);

  switch (outcome.status) {
    case "ok":
      redirect("/");
    case "invalid_credentials":
      return { status: "error", message: errors.invalidCredentials };
    case "email_not_verified":
      return { status: "error", message: errors.emailNotVerified };
    case "failed":
      return { status: "error", message: errors.invalidCredentials };
  }
}

export async function resendVerificationAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const errors = t.errors;

  const parsed = resendVerificationFormSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return { status: "error", message: errors.invalidInput };
  }

  const requestHeaders = await headers();
  const outcome = await resendVerification(parsed.data.email, requestHeaders);

  switch (outcome.status) {
    case "ok":
      return { status: "success", message: t.verifyEmail.resent };
    case "failed":
      return { status: "error", message: errors.resendFailed };
  }
}

export async function signOutAction(): Promise<void> {
  const requestHeaders = await headers();
  await signOut(requestHeaders);
  redirect("/entrar");
}
