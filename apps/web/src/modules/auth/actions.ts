"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getDb } from "@/db/client";

import { AccountRateLimitExceededError, enforceAccountRateLimit } from "./account-rate-limit";
import type { ActionState } from "./action-state";
import { requireUser, withAuthenticatedAction } from "./session";
import {
  deleteAccount,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  signIn,
  signInMagicLink,
  signOut,
  signUp,
} from "./service";
import { t } from "./strings";
import {
  deleteAccountFormSchema,
  magicLinkFormSchema,
  requestPasswordResetFormSchema,
  resendVerificationFormSchema,
  resetPasswordFormSchema,
  signInFormSchema,
  signUpFormSchema,
} from "./validation";

export async function signUpAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const errors = t.errors;

  const parsed = signUpFormSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    termsAccepted: formData.get("termsAccepted") === "on",
    privacyAccepted: formData.get("privacyAccepted") === "on",
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
      privacyAccepted: true,
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
    case "rate_limited":
      return { status: "error", message: errors.rateLimited };
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
    case "rate_limited":
      return { status: "error", message: errors.rateLimited };
    case "failed":
      return { status: "error", message: errors.signInFailed };
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
    case "rate_limited":
      return { status: "error", message: errors.rateLimited };
    case "failed":
      return { status: "error", message: errors.resendFailed };
  }
}

export async function signInMagicLinkAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const errors = t.errors;

  const parsed = magicLinkFormSchema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return { status: "error", message: errors.invalidInput };
  }

  const requestHeaders = await headers();
  const outcome = await signInMagicLink({ email: parsed.data.email }, requestHeaders);

  switch (outcome.status) {
    case "ok":
      redirect(`/link-magico/verifique?email=${encodeURIComponent(parsed.data.email)}`);
    case "rate_limited":
      return { status: "error", message: errors.rateLimited };
    case "failed":
      return { status: "error", message: errors.magicLinkFailed };
  }
}

export async function requestPasswordResetAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const errors = t.errors;

  const parsed = requestPasswordResetFormSchema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return { status: "error", message: errors.invalidInput };
  }

  const requestHeaders = await headers();
  const outcome = await requestPasswordReset({ email: parsed.data.email }, requestHeaders);

  switch (outcome.status) {
    case "ok":
      redirect(`/redefinir-senha/verifique?email=${encodeURIComponent(parsed.data.email)}`);
    case "rate_limited":
      return { status: "error", message: errors.rateLimited };
    case "failed":
      return { status: "error", message: errors.passwordResetRequestFailed };
  }
}

export async function resetPasswordAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const errors = t.errors;

  const parsed = resetPasswordFormSchema.safeParse({
    token: formData.get("token"),
    newPassword: formData.get("newPassword"),
  });

  if (!parsed.success) {
    return { status: "error", message: errors.invalidInput };
  }

  const requestHeaders = await headers();
  const outcome = await resetPassword(parsed.data, requestHeaders);

  switch (outcome.status) {
    case "ok":
      redirect("/entrar");
    case "invalid_token":
      return { status: "error", message: errors.invalidResetToken };
    case "rate_limited":
      return { status: "error", message: errors.rateLimited };
    case "failed":
      return { status: "error", message: errors.passwordResetFailed };
  }
}

export async function signOutAction(): Promise<void> {
  const requestHeaders = await headers();
  await signOut(requestHeaders);
  redirect("/entrar");
}

// The action's own account bucket (docs/adr/0027): Better Auth's rule on
// `/delete-user` is per IP, and this one is per signed-in account.
const DELETE_ACCOUNT_RATE_LIMIT = { windowSeconds: 60, max: 3 };

export async function deleteAccountAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const errors = t.errors;

  const parsed = deleteAccountFormSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    return { status: "error", message: errors.invalidPassword };
  }

  const outcome = await withAuthenticatedAction(async () => {
    const user = await requireUser();
    try {
      await enforceAccountRateLimit(
        getDb(),
        user.email,
        "account/delete",
        DELETE_ACCOUNT_RATE_LIMIT,
      );
    } catch (error) {
      if (error instanceof AccountRateLimitExceededError) {
        return { status: "rate_limited" } as const;
      }
      throw error;
    }
    return deleteAccount(parsed.data.password, await headers());
  });

  switch (outcome.status) {
    case "ok":
      redirect("/conta-excluida");
    case "invalid_password":
      return { status: "error", message: errors.invalidPassword };
    case "rate_limited":
      return { status: "error", message: errors.rateLimited };
    case "failed":
      return { status: "error", message: errors.deleteAccountFailed };
  }
}
