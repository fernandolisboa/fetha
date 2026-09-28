import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";

import { getAuth } from "./auth";
import { openVerificationLink } from "./registration-test-support";
import { account, mailOutbox, user } from "./schema";
import {
  requestPasswordReset,
  resendVerification,
  resetPassword,
  setInitialPassword,
  signIn,
  signUp,
} from "./service";
import { testRequestHeaders } from "./test-support";
import { findLatestVerificationLink } from "./verification-link";

const ATTACKER_PASSWORD = "attacker-chosen-password";

function uniqueEmail(label: string): string {
  return `fetha-pre-hijack-${label}-${crypto.randomUUID()}@example.com`;
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

// The endpoint is reachable directly, so an attacker is not bound by the
// sign-up form and can send a password of their choosing (security audit
// 2026-09-27, C-01).
async function attackerSignsUp(email: string, name = "Mallory"): Promise<void> {
  const response = await getAuth().handler(
    new Request(new URL("/api/auth/sign-up/email", process.env.BETTER_AUTH_URL), {
      method: "POST",
      headers: new Headers({
        "content-type": "application/json",
        "x-forwarded-for": testRequestHeaders().get("x-forwarded-for") ?? "",
      }),
      body: JSON.stringify({
        name,
        email,
        password: ATTACKER_PASSWORD,
        termsAccepted: true,
        privacyAccepted: true,
      }),
    }),
  );
  expect(response.status).toBe(200);
}

async function captureResetToken(email: string): Promise<string> {
  const link = await findLatestVerificationLink(getDb(), email);
  if (!link) {
    throw new Error(`no reset email was captured for ${email}`);
  }
  const callback = await getAuth().handler(new Request(link));
  const location = callback.headers.get("location");
  const token = location ? new URL(location, link).searchParams.get("token") : null;
  if (!token) {
    throw new Error("reset-password callback did not carry a token");
  }
  return token;
}

describe("account pre-hijacking (#144)", () => {
  it("does not let the registrant's password survive the mailbox owner's verification", async () => {
    const email = uniqueEmail("survive");
    createdEmails.push(email);
    await attackerSignsUp(email);
    await getDb().delete(mailOutbox).where(eq(mailOutbox.to, email));

    expect((await resendVerification(email, testRequestHeaders())).status).toBe("ok");
    await openVerificationLink(email);

    const attacker = await signIn({ email, password: ATTACKER_PASSWORD }, testRequestHeaders());
    expect(attacker.status).toBe("invalid_credentials");
  });

  it("lets whoever opens the link set their own password and sign in with it", async () => {
    const email = uniqueEmail("own-password");
    createdEmails.push(email);
    await attackerSignsUp(email);

    const sessionHeaders = await openVerificationLink(email);
    expect((await setInitialPassword("the-owners-own-password", sessionHeaders)).status).toBe("ok");

    const owner = await signIn(
      { email, password: "the-owners-own-password" },
      testRequestHeaders(),
    );
    expect(owner.status).toBe("ok");
    const attacker = await signIn({ email, password: ATTACKER_PASSWORD }, testRequestHeaders());
    expect(attacker.status).toBe("invalid_credentials");
  });

  it("refuses a second password once one is set", async () => {
    const email = uniqueEmail("second-password");
    createdEmails.push(email);
    await signUp(
      { name: "Owner", email, termsAccepted: true, privacyAccepted: true },
      testRequestHeaders(),
    );
    const sessionHeaders = await openVerificationLink(email);
    expect((await setInitialPassword("the-first-password", sessionHeaders)).status).toBe("ok");

    expect((await setInitialPassword("a-second-password", sessionHeaders)).status).toBe(
      "already_set",
    );
    const outcome = await signIn({ email, password: "the-first-password" }, testRequestHeaders());
    expect(outcome.status).toBe("ok");
  });

  it("refuses to set a password without a session", async () => {
    const outcome = await setInitialPassword("no-session-password", testRequestHeaders());
    expect(outcome.status).toBe("failed");
  });

  it("keeps a still-unverified account and sends it a fresh link when the email signs up again", async () => {
    const email = uniqueEmail("resend-on-sign-up");
    createdEmails.push(email);
    await attackerSignsUp(email);
    const [pending] = await getDb().select().from(user).where(eq(user.email, email));
    await getDb().delete(mailOutbox).where(eq(mailOutbox.to, email));

    const outcome = await signUp(
      { name: "Vitoria Dona", email, termsAccepted: true, privacyAccepted: true },
      testRequestHeaders(),
    );

    expect(outcome.status).toBe("ok");
    const rows = await getDb().select().from(user).where(eq(user.email, email));
    expect(rows.map((row) => row.id)).toEqual([pending?.id]);
    const sessionHeaders = await openVerificationLink(email);
    expect((await setInitialPassword("the-owners-own-password", sessionHeaders)).status).toBe("ok");
    const attacker = await signIn({ email, password: ATTACKER_PASSWORD }, testRequestHeaders());
    expect(attacker.status).toBe("invalid_credentials");
  });

  it("limits sign-ups per email, whatever the IP", async () => {
    const email = uniqueEmail("per-email-limit");
    createdEmails.push(email);
    const attempt = () =>
      signUp(
        { name: "Owner", email, termsAccepted: true, privacyAccepted: true },
        testRequestHeaders(),
      );

    for (let index = 0; index < 3; index += 1) {
      expect((await attempt()).status).toBe("ok");
    }
    expect((await attempt()).status).toBe("rate_limited");
  });

  it("keeps a verified account when the email signs up again", async () => {
    const email = uniqueEmail("keep-verified");
    createdEmails.push(email);
    await signUp(
      { name: "Owner", email, termsAccepted: true, privacyAccepted: true },
      testRequestHeaders(),
    );
    const sessionHeaders = await openVerificationLink(email);
    await setInitialPassword("the-owners-password", sessionHeaders);
    const [before] = await getDb().select().from(user).where(eq(user.email, email));

    const outcome = await signUp(
      { name: "Mallory", email, termsAccepted: true, privacyAccepted: true },
      testRequestHeaders(),
    );

    expect(outcome.status).toBe("ok");
    const [after] = await getDb().select().from(user).where(eq(user.email, email));
    expect(after?.id).toBe(before?.id);
    expect(after?.name).toBe("Owner");
  });

  it("verifies the account when its password is reset through the emailed link", async () => {
    const email = uniqueEmail("reset-verifies");
    createdEmails.push(email);
    await attackerSignsUp(email);
    await getDb().delete(mailOutbox).where(eq(mailOutbox.to, email));

    await requestPasswordReset({ email }, testRequestHeaders());
    const token = await captureResetToken(email);
    const reset = await resetPassword(
      { token, newPassword: "the-owners-reset-password" },
      testRequestHeaders(),
    );
    expect(reset.status).toBe("ok");

    const [row] = await getDb().select().from(user).where(eq(user.email, email));
    expect(row?.emailVerified).toBe(true);
    const owner = await signIn(
      { email, password: "the-owners-reset-password" },
      testRequestHeaders(),
    );
    expect(owner.status).toBe("ok");
    const attacker = await signIn({ email, password: ATTACKER_PASSWORD }, testRequestHeaders());
    expect(attacker.status).toBe("invalid_credentials");
  });

  it("stores no password the registrant chose through the sign-up form", async () => {
    const email = uniqueEmail("no-form-password");
    createdEmails.push(email);
    await signUp(
      { name: "Owner", email, termsAccepted: true, privacyAccepted: true },
      testRequestHeaders(),
    );
    await openVerificationLink(email);

    const [row] = await getDb().select().from(user).where(eq(user.email, email));
    const accounts = await getDb()
      .select()
      .from(account)
      .where(eq(account.userId, row?.id ?? ""));
    expect(row?.emailVerified).toBe(true);
    expect(accounts).toHaveLength(0);
  });
});
