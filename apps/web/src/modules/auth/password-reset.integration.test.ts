import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { verification } from "./schema";
import { deleteTestUser } from "@/db/test/cleanup";

import { getAuth } from "./auth";
import { requestPasswordReset, resetPassword, signIn, signUp } from "./service";
import { testRequestHeaders } from "./test-support";
import { findLatestVerificationLink } from "./verification-link";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

function uniqueEmail(label: string): string {
  return `fetha-password-reset-${label}-${crypto.randomUUID()}@example.com`;
}

async function verifyEmail(email: string): Promise<void> {
  const link = await findLatestVerificationLink(getDb(), email);
  if (!link) {
    throw new Error(`no email was captured for ${email}`);
  }
  const token = new URL(link).searchParams.get("token");
  if (!token) {
    throw new Error("verification link did not contain a token");
  }
  await getAuth().api.verifyEmail({ query: { token } });
}

async function registerVerifiedUser(
  email: string,
  headers: Headers,
  password = "correct-horse-battery",
): Promise<void> {
  const outcome = await signUp(
    { name: "Password Reset User", email, password, termsAccepted: true, privacyAccepted: true },
    headers,
  );
  expect(outcome.status).toBe("ok");
  await verifyEmail(email);
}

async function captureResetToken(email: string): Promise<string> {
  const link = await findLatestVerificationLink(getDb(), email);
  if (!link) {
    throw new Error(`no reset email was captured for ${email}`);
  }
  // The emailed link is the GET reset-password/:token callback, not the
  // POST endpoint: clicking it redirects to our confirm page with `?token=`
  // set only once Better Auth has checked the token is still valid.
  const response = await getAuth().handler(
    new Request(link, { method: "GET", headers: testRequestHeaders() }),
  );
  const location = response.headers.get("location");
  if (!location) {
    throw new Error("reset-password callback did not redirect");
  }
  const token = new URL(location, "http://localhost:3000").searchParams.get("token");
  if (!token) {
    throw new Error("reset-password callback did not carry a token");
  }
  return token;
}

async function expireResetToken(token: string): Promise<void> {
  await getDb()
    .update(verification)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(verification.identifier, `reset-password:${token}`));
}

const createdEmails: string[] = [];

beforeEach(() => {
  process.env.REGISTRATION_MODE = "open";
});

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("password reset", () => {
  it("lets a user set a new password and sign in with it", async () => {
    const email = uniqueEmail("reset");
    createdEmails.push(email);
    const headers = testRequestHeaders();
    await registerVerifiedUser(email, headers, "the-old-password-here");

    const requestOutcome = await requestPasswordReset({ email }, headers);
    expect(requestOutcome.status).toBe("ok");

    const token = await captureResetToken(email);
    const resetOutcome = await resetPassword(
      { token, newPassword: "the-new-password-here" },
      headers,
    );
    expect(resetOutcome.status).toBe("ok");

    const oldPasswordOutcome = await signIn({ email, password: "the-old-password-here" }, headers);
    expect(oldPasswordOutcome.status).toBe("invalid_credentials");

    const newPasswordOutcome = await signIn({ email, password: "the-new-password-here" }, headers);
    expect(newPasswordOutcome.status).toBe("ok");
  });

  it("rejects reusing an already-consumed reset token", async () => {
    const email = uniqueEmail("reuse");
    createdEmails.push(email);
    const headers = testRequestHeaders();
    await registerVerifiedUser(email, headers);

    await requestPasswordReset({ email }, headers);
    const token = await captureResetToken(email);

    const first = await resetPassword({ token, newPassword: "first-new-password" }, headers);
    expect(first.status).toBe("ok");

    const second = await resetPassword({ token, newPassword: "second-new-password" }, headers);
    expect(second.status).toBe("invalid_token");
  });

  it("rejects an expired reset token", async () => {
    const email = uniqueEmail("expired");
    createdEmails.push(email);
    const headers = testRequestHeaders();
    await registerVerifiedUser(email, headers);

    await requestPasswordReset({ email }, headers);
    const token = await captureResetToken(email);
    await expireResetToken(token);

    const outcome = await resetPassword({ token, newPassword: "a-new-password-here" }, headers);
    expect(outcome.status).toBe("invalid_token");
  });

  it("returns the same generic outcome whether or not the email has an account", async () => {
    const noAccountEmail = uniqueEmail("no-account");
    const headers = testRequestHeaders();

    const outcome = await requestPasswordReset({ email: noAccountEmail }, headers);
    expect(outcome.status).toBe("ok");
  });

  // Round-3 review item 3: revokeSessionsOnPasswordReset (options.ts) must
  // actually revoke a session minted before the reset, not merely be set.
  it("unauthenticates a session that was minted before the password reset", async () => {
    const email = uniqueEmail("revoke-on-reset");
    createdEmails.push(email);
    const headers = testRequestHeaders();
    await registerVerifiedUser(email, headers, "the-old-password-here");

    const signInResponse = await getAuth().api.signInEmail({
      body: { email, password: "the-old-password-here" },
      asResponse: true,
    });
    const cookie = signInResponse.headers.get("set-cookie");
    expect(cookie).toBeTruthy();
    const sessionHeaders = new Headers({ cookie: cookie ?? "" });

    const sessionBefore = await getAuth().api.getSession({ headers: sessionHeaders });
    expect(sessionBefore).not.toBeNull();

    await requestPasswordReset({ email }, headers);
    const token = await captureResetToken(email);
    const resetOutcome = await resetPassword(
      { token, newPassword: "the-new-password-here" },
      headers,
    );
    expect(resetOutcome.status).toBe("ok");

    const sessionAfter = await getAuth().api.getSession({ headers: sessionHeaders });
    expect(sessionAfter).toBeNull();
  });

  it("rejects an invalid, made-up reset token", async () => {
    const headers = testRequestHeaders();
    const outcome = await resetPassword(
      { token: "not-a-real-token", newPassword: "a-new-password-here" },
      headers,
    );
    expect(outcome.status).toBe("invalid_token");
  });
});
