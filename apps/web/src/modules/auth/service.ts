import { parseSetCookieHeader, toCookieOptions } from "better-auth/cookies";
import { cookies as readCookies } from "next/headers";

import { getAuth } from "./auth";
import { readAuthBaseUrl } from "./env";

// One calling convention throughout this module: every Better Auth call
// goes through the HTTP handler (not `auth.api.*`), because the rate
// limiter runs only inside the router's onRequest hook, which `auth.handler()`
// triggers and `auth.api.*` bypasses entirely — calling `auth.api.*` here
// would silently exempt that call from rate limiting. The handler path is
// required both for the 429 -> rate_limited mapping (every outcome here is
// derived from a real HTTP status code and JSON error `code` — invalid
// credentials, unverified email, rate limiting; `auth.api.*` only throws
// APIError on failure, which would need its own separate mapping) and for
// ticket #10, which turns rate limiting on (docs/adr/0016).
const AUTH_BASE_PATH = "/api/auth";

function logAuthHandlerError(error: unknown): void {
  console.error("auth handler request failed", error instanceof Error ? error.name : "Unknown");
}

function buildAuthRequest(path: string, body: unknown, requestHeaders: Headers): Request {
  const url = new URL(`${AUTH_BASE_PATH}${path}`, readAuthBaseUrl());
  const headers = new Headers(requestHeaders);
  headers.set("content-type", "application/json");
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

// The `nextCookies` plugin (options.ts) never fires for this call path: its
// `after` hook bails out whenever `ctx._flag === "router"`, which is exactly
// the flag Better Auth's own router sets while running `auth.handler()`. A
// Response built that way carries a real `Set-Cookie` header, but nothing
// forwards it into Next's `cookies()` unless a Server Action does it
// explicitly, so every call here does it itself instead of relying on the
// plugin.
async function forwardSetCookies(response: Response): Promise<void> {
  const setCookieHeader = response.headers.get("set-cookie");
  if (!setCookieHeader) {
    return;
  }

  let cookieStore: Awaited<ReturnType<typeof readCookies>>;
  try {
    cookieStore = await readCookies();
  } catch {
    // Outside a Next.js request scope (e.g. a plain integration test calling
    // this module directly); nothing to forward to.
    return;
  }

  parseSetCookieHeader(setCookieHeader).forEach((attributes, name) => {
    if (!name) {
      return;
    }
    try {
      cookieStore.set(name, attributes.value, toCookieOptions(attributes));
    } catch {
      // Next.js refuses cookie mutation during a Server Component render;
      // every caller of this module is a Server Action, but stay defensive.
    }
  });
}

async function callAuthHandler(
  path: string,
  body: unknown,
  requestHeaders: Headers,
): Promise<Response | undefined> {
  try {
    const response = await getAuth().handler(buildAuthRequest(path, body, requestHeaders));
    await forwardSetCookies(response);
    return response;
  } catch (error) {
    logAuthHandlerError(error);
    return undefined;
  }
}

async function readJson<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
  termsAccepted: boolean;
  privacyAccepted: boolean;
}

export type SignUpOutcome =
  | { status: "ok"; userId?: string }
  | { status: "terms_not_accepted" }
  | { status: "registration_closed" }
  | { status: "sign_up_failed" };

export async function signUp(input: SignUpInput, requestHeaders: Headers): Promise<SignUpOutcome> {
  const response = await callAuthHandler(
    "/sign-up/email",
    {
      name: input.name,
      email: input.email,
      password: input.password,
      termsAccepted: input.termsAccepted,
      privacyAccepted: input.privacyAccepted,
      callbackURL: "/verificar-email/resultado",
    },
    requestHeaders,
  );

  if (!response) {
    return { status: "sign_up_failed" };
  }

  if (!response.ok) {
    const body = await readJson<{ message?: string }>(response);
    if (body?.message === "registration_closed") {
      return { status: "registration_closed" };
    }
    if (body?.message === "terms_not_accepted" || body?.message === "privacy_not_accepted") {
      return { status: "terms_not_accepted" };
    }
    if (body?.message === "invite_required") {
      // No enumeration (docs/adr/0016): an email with no pending invite
      // gets the exact same outward response as a real sign-up.
      return { status: "ok" };
    }
    return { status: "sign_up_failed" };
  }

  const body = await readJson<{ user?: { id?: string } }>(response);
  if (!body?.user?.id) {
    return { status: "sign_up_failed" };
  }
  return { status: "ok", userId: body.user.id };
}

export interface SignInInput {
  email: string;
  password: string;
}

export type SignInOutcome =
  | { status: "ok" }
  | { status: "invalid_credentials" }
  | { status: "email_not_verified" }
  | { status: "rate_limited" }
  | { status: "failed" };

export async function signIn(input: SignInInput, requestHeaders: Headers): Promise<SignInOutcome> {
  const response = await callAuthHandler("/sign-in/email", input, requestHeaders);

  if (!response) {
    return { status: "failed" };
  }

  if (response.ok) {
    return { status: "ok" };
  }

  if (response.status === 429) {
    return { status: "rate_limited" };
  }

  const body = await readJson<{ code?: string }>(response);
  if (body?.code === "EMAIL_NOT_VERIFIED") {
    return { status: "email_not_verified" };
  }
  if (response.status >= 400 && response.status < 500) {
    return { status: "invalid_credentials" };
  }
  return { status: "failed" };
}

export type ResendVerificationOutcome = { status: "ok" } | { status: "failed" };

export async function resendVerification(
  email: string,
  requestHeaders: Headers,
): Promise<ResendVerificationOutcome> {
  const response = await callAuthHandler(
    "/send-verification-email",
    { email, callbackURL: "/verificar-email/resultado" },
    requestHeaders,
  );

  if (!response?.ok) {
    return { status: "failed" };
  }

  return { status: "ok" };
}

export interface SignInMagicLinkInput {
  email: string;
}

export type SignInMagicLinkOutcome =
  { status: "ok" } | { status: "rate_limited" } | { status: "failed" };

export async function signInMagicLink(
  input: SignInMagicLinkInput,
  requestHeaders: Headers,
): Promise<SignInMagicLinkOutcome> {
  const response = await callAuthHandler(
    "/sign-in/magic-link",
    {
      email: input.email,
      callbackURL: "/",
      errorCallbackURL: "/link-magico/erro",
    },
    requestHeaders,
  );

  if (!response) {
    return { status: "failed" };
  }
  if (response.status === 429) {
    return { status: "rate_limited" };
  }
  if (!response.ok) {
    return { status: "failed" };
  }
  return { status: "ok" };
}

export interface RequestPasswordResetInput {
  email: string;
}

export type RequestPasswordResetOutcome =
  { status: "ok" } | { status: "rate_limited" } | { status: "failed" };

export async function requestPasswordReset(
  input: RequestPasswordResetInput,
  requestHeaders: Headers,
): Promise<RequestPasswordResetOutcome> {
  const response = await callAuthHandler(
    "/request-password-reset",
    {
      email: input.email,
      redirectTo: "/redefinir-senha/confirmar",
    },
    requestHeaders,
  );

  if (!response) {
    return { status: "failed" };
  }
  if (response.status === 429) {
    return { status: "rate_limited" };
  }
  if (!response.ok) {
    return { status: "failed" };
  }
  return { status: "ok" };
}

export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

export type ResetPasswordOutcome =
  | { status: "ok" }
  | { status: "invalid_token" }
  | { status: "rate_limited" }
  | { status: "failed" };

export async function resetPassword(
  input: ResetPasswordInput,
  requestHeaders: Headers,
): Promise<ResetPasswordOutcome> {
  const response = await callAuthHandler(
    "/reset-password",
    { token: input.token, newPassword: input.newPassword },
    requestHeaders,
  );

  if (!response) {
    return { status: "failed" };
  }
  if (response.status === 429) {
    return { status: "rate_limited" };
  }
  if (response.ok) {
    return { status: "ok" };
  }

  const body = await readJson<{ code?: string }>(response);
  if (body?.code === "INVALID_TOKEN") {
    return { status: "invalid_token" };
  }
  return { status: "failed" };
}

export async function signOut(requestHeaders: Headers): Promise<void> {
  await callAuthHandler("/sign-out", {}, requestHeaders);
}
