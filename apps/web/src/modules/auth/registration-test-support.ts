import { parseSetCookieHeader } from "better-auth/cookies";

import { getDb } from "@/db/client";

import { getAuth } from "./auth";
import { setInitialPassword, signUp } from "./service";
import { findLatestVerificationLink } from "./verification-link";

// Integration-test helpers for the email-first registration (docs/adr/0016,
// #144): the verification link signs its opener in, and only then is a
// password set.

function toCookieHeader(setCookie: string | null): string {
  if (!setCookie) {
    return "";
  }
  return [...parseSetCookieHeader(setCookie)]
    .map(([name, attributes]) => `${name}=${attributes.value}`)
    .join("; ");
}

export async function openVerificationLink(email: string): Promise<Headers> {
  const link = await findLatestVerificationLink(getDb(), email);
  const token = link ? new URL(link).searchParams.get("token") : null;
  if (!token) {
    throw new Error(`no verification link was captured for ${email}`);
  }
  const { headers } = await getAuth().api.verifyEmail({ query: { token }, returnHeaders: true });
  return new Headers({ cookie: toCookieHeader(headers.get("set-cookie")) });
}

export async function registerVerifiedUser(
  input: { name: string; email: string; password: string },
  requestHeaders: Headers,
): Promise<void> {
  const outcome = await signUp(
    { name: input.name, email: input.email, termsAccepted: true, privacyAccepted: true },
    requestHeaders,
  );
  if (outcome.status !== "ok") {
    throw new Error(`sign-up failed for ${input.email}: ${outcome.status}`);
  }
  const session = await openVerificationLink(input.email);
  const passwordOutcome = await setInitialPassword(input.password, session);
  if (passwordOutcome.status !== "ok") {
    throw new Error(`setting the password failed for ${input.email}: ${passwordOutcome.status}`);
  }
}
