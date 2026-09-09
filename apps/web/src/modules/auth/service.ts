import { getAuth } from "./auth";
import { readAuthBaseUrl } from "./env";

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

async function callAuthHandler(
  path: string,
  body: unknown,
  requestHeaders: Headers,
): Promise<Response | undefined> {
  try {
    return await getAuth().handler(buildAuthRequest(path, body, requestHeaders));
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
}

export type SignUpOutcome =
  | { status: "ok"; userId: string }
  | { status: "terms_not_accepted" }
  | { status: "registration_closed" }
  | { status: "invite_required" }
  | { status: "sign_up_failed" };

export async function signUp(input: SignUpInput, requestHeaders: Headers): Promise<SignUpOutcome> {
  const response = await callAuthHandler(
    "/sign-up/email",
    {
      name: input.name,
      email: input.email,
      password: input.password,
      termsAccepted: input.termsAccepted,
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
    if (body?.message === "invite_required") {
      return { status: "invite_required" };
    }
    if (body?.message === "terms_not_accepted") {
      return { status: "terms_not_accepted" };
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
  | { status: "failed" };

export async function signIn(input: SignInInput, requestHeaders: Headers): Promise<SignInOutcome> {
  const response = await callAuthHandler("/sign-in/email", input, requestHeaders);

  if (!response) {
    return { status: "failed" };
  }

  if (!response.ok) {
    return { status: response.status === 403 ? "email_not_verified" : "invalid_credentials" };
  }

  return { status: "ok" };
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

export async function signOut(requestHeaders: Headers): Promise<void> {
  await getAuth().api.signOut({ headers: requestHeaders });
}
