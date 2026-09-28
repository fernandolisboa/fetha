import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";

import { getAuth } from "./auth";
import { openVerificationLink, registerVerifiedUser } from "./registration-test-support";
import { termsAcceptances, user } from "./schema";
import { requestPasswordReset, resetPassword, signIn, signInMagicLink, signUp } from "./service";
import { testRequestHeaders } from "./test-support";
import { CURRENT_TERMS_VERSION } from "./terms";
import { acceptTerms } from "./terms-consent";
import { readTermsGate } from "./terms-gate";
import { findLatestVerificationLink } from "./verification-link";

function uniqueEmail(label: string): string {
  return `fetha-terms-reacceptance-${label}-${crypto.randomUUID()}@example.com`;
}

async function insertUser(
  email: string,
  termsVersion: string | null,
): Promise<{ id: string; name: string; email: string; emailVerified: boolean }> {
  const [row] = await getDb()
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Reacceptance User",
      email,
      emailVerified: true,
      termsVersion,
      termsAcceptedAt: termsVersion ? new Date() : null,
    })
    .returning({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
    });
  if (!row) {
    throw new Error("failed to insert test user");
  }
  return row;
}

async function captureResetToken(email: string): Promise<string> {
  const link = await findLatestVerificationLink(getDb(), email);
  if (!link) {
    throw new Error(`no reset email was captured for ${email}`);
  }
  const response = await getAuth().handler(
    new Request(link, { method: "GET", headers: testRequestHeaders() }),
  );
  const location = response.headers.get("location");
  const token = location ? new URL(location, link).searchParams.get("token") : null;
  if (!token) {
    throw new Error("reset-password callback did not carry a token");
  }
  return token;
}

async function captureMagicLinkUrl(email: string): Promise<URL> {
  const link = await findLatestVerificationLink(getDb(), email);
  if (!link) {
    throw new Error(`no magic link was captured for ${email}`);
  }
  return new URL(link);
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

describe("terms re-acceptance gate (#142)", () => {
  it("is stale for an older accepted version", async () => {
    const email = uniqueEmail("older");
    createdEmails.push(email);
    const testUser = await insertUser(email, "2020-01-01.1");

    expect(await readTermsGate(getDb(), testUser)).toEqual({ state: "stale" });
  });

  it("is unconfirmed for a NULL accepted version", async () => {
    const email = uniqueEmail("null");
    createdEmails.push(email);
    const testUser = await insertUser(email, null);

    expect(await readTermsGate(getDb(), testUser)).toEqual({ state: "unconfirmed" });
  });

  it("is current for the current accepted version", async () => {
    const email = uniqueEmail("current");
    createdEmails.push(email);
    const testUser = await insertUser(email, CURRENT_TERMS_VERSION);

    expect(await readTermsGate(getDb(), testUser)).toEqual({ state: "current" });
  });

  it("records the current version and the acceptance time on the user row and a history row", async () => {
    const email = uniqueEmail("record");
    createdEmails.push(email);
    const testUser = await insertUser(email, null);

    const before = new Date();
    const outcome = await acceptTerms(getDb(), testUser, { name: "Confirmed Name" });
    const after = new Date();

    expect(outcome).toEqual({ status: "ok" });
    const [row] = await getDb().select().from(user).where(eq(user.id, testUser.id));
    expect(row?.termsVersion).toBe(CURRENT_TERMS_VERSION);
    expect(row?.name).toBe("Confirmed Name");
    expect(row?.termsAcceptedAt?.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(row?.termsAcceptedAt?.getTime()).toBeLessThanOrEqual(after.getTime());

    const history = await getDb()
      .select()
      .from(termsAcceptances)
      .where(eq(termsAcceptances.userId, testUser.id));
    expect(history).toHaveLength(1);
    expect(history[0]?.termsVersion).toBe(CURRENT_TERMS_VERSION);
  });

  it("leaves the name untouched when no name is given (the stale-version state)", async () => {
    const email = uniqueEmail("no-name");
    createdEmails.push(email);
    const testUser = await insertUser(email, "2020-01-01.1");

    const outcome = await acceptTerms(getDb(), testUser);

    expect(outcome).toEqual({ status: "ok" });
    const [row] = await getDb().select().from(user).where(eq(user.id, testUser.id));
    expect(row?.name).toBe("Reacceptance User");
    expect(row?.termsVersion).toBe(CURRENT_TERMS_VERSION);
  });

  it("requires a name in the unconfirmed state and writes nothing without one", async () => {
    const email = uniqueEmail("name-required");
    createdEmails.push(email);
    const testUser = await insertUser(email, null);

    const outcome = await acceptTerms(getDb(), testUser);

    expect(outcome).toEqual({ status: "name_required" });
    const [row] = await getDb().select().from(user).where(eq(user.id, testUser.id));
    expect(row?.termsVersion).toBeNull();
    const history = await getDb()
      .select()
      .from(termsAcceptances)
      .where(eq(termsAcceptances.userId, testUser.id));
    expect(history).toHaveLength(0);
  });

  it("treats a double submit as one accept: the second returns already_current and writes no second history row", async () => {
    const email = uniqueEmail("double-submit");
    createdEmails.push(email);
    const testUser = await insertUser(email, null);

    const first = await acceptTerms(getDb(), testUser, { name: "First Submit" });
    const second = await acceptTerms(getDb(), testUser, { name: "Second Submit" });

    expect(first).toEqual({ status: "ok" });
    expect(second).toEqual({ status: "already_current" });

    const [row] = await getDb().select().from(user).where(eq(user.id, testUser.id));
    expect(row?.name).toBe("First Submit");
    const history = await getDb()
      .select()
      .from(termsAcceptances)
      .where(eq(termsAcceptances.userId, testUser.id));
    expect(history).toHaveLength(1);
  });

  it("reports unauthenticated and writes nothing when the account no longer exists", async () => {
    const email = uniqueEmail("deleted");
    const testUser = await insertUser(email, null);
    await getDb().delete(user).where(eq(user.id, testUser.id));

    const outcome = await acceptTerms(getDb(), testUser, { name: "Ghost" });

    expect(outcome).toEqual({ status: "unauthenticated" });
    const history = await getDb()
      .select()
      .from(termsAcceptances)
      .where(eq(termsAcceptances.userId, testUser.id));
    expect(history).toHaveLength(0);
  });

  it("accepting as user A writes nothing for user B", async () => {
    const emailA = uniqueEmail("isolation-a");
    const emailB = uniqueEmail("isolation-b");
    createdEmails.push(emailA, emailB);
    const userA = await insertUser(emailA, null);
    const userB = await insertUser(emailB, null);

    await acceptTerms(getDb(), userA, { name: "User A" });

    const [rowB] = await getDb().select().from(user).where(eq(user.id, userB.id));
    expect(rowB?.termsVersion).toBeNull();
    expect(rowB?.name).toBe("Reacceptance User");

    const historyBCount = await getDb()
      .select()
      .from(termsAcceptances)
      .where(eq(termsAcceptances.userId, userB.id));
    expect(historyBCount).toHaveLength(0);
  });

  it("clears terms acceptance when a verification link proves an unverified mailbox", async () => {
    const email = uniqueEmail("verification-link");
    createdEmails.push(email);
    const headers = testRequestHeaders();
    const outcome = await signUp(
      { name: "Verification User", email, termsAccepted: true, privacyAccepted: true },
      headers,
    );
    expect(outcome.status).toBe("ok");

    const [before] = await getDb().select().from(user).where(eq(user.email, email));
    expect(before?.termsVersion).toBe(CURRENT_TERMS_VERSION);

    await openVerificationLink(email);

    const [after] = await getDb().select().from(user).where(eq(user.email, email));
    expect(after?.emailVerified).toBe(true);
    expect(after?.termsVersion).toBeNull();
    expect(after?.termsAcceptedAt).toBeNull();
  });

  it("clears terms acceptance when a magic-link sign-in proves an unverified mailbox", async () => {
    const email = uniqueEmail("magic-link");
    createdEmails.push(email);
    const headers = testRequestHeaders();
    const outcome = await signUp(
      { name: "Magic Link User", email, termsAccepted: true, privacyAccepted: true },
      headers,
    );
    expect(outcome.status).toBe("ok");

    const [before] = await getDb().select().from(user).where(eq(user.email, email));
    expect(before?.emailVerified).toBe(false);
    expect(before?.termsVersion).toBe(CURRENT_TERMS_VERSION);

    const magicLinkOutcome = await signInMagicLink({ email }, headers);
    expect(magicLinkOutcome.status).toBe("ok");
    const url = await captureMagicLinkUrl(email);
    const response = await getAuth().handler(new Request(url, { method: "GET", headers }));
    expect(response.headers.get("location")).not.toContain("error");

    const [after] = await getDb().select().from(user).where(eq(user.email, email));
    expect(after?.emailVerified).toBe(true);
    expect(after?.termsVersion).toBeNull();
    expect(after?.termsAcceptedAt).toBeNull();
  });

  it("clears terms acceptance when a password reset proves an unverified mailbox", async () => {
    const email = uniqueEmail("password-reset");
    createdEmails.push(email);
    const headers = testRequestHeaders();
    const outcome = await signUp(
      { name: "Password Reset User", email, termsAccepted: true, privacyAccepted: true },
      headers,
    );
    expect(outcome.status).toBe("ok");

    const [before] = await getDb().select().from(user).where(eq(user.email, email));
    expect(before?.emailVerified).toBe(false);
    expect(before?.termsVersion).toBe(CURRENT_TERMS_VERSION);

    const requestOutcome = await requestPasswordReset({ email }, headers);
    expect(requestOutcome.status).toBe("ok");
    const token = await captureResetToken(email);
    const resetOutcome = await resetPassword(
      { token, newPassword: "the-owners-reset-password" },
      headers,
    );
    expect(resetOutcome.status).toBe("ok");

    const [after] = await getDb().select().from(user).where(eq(user.email, email));
    expect(after?.emailVerified).toBe(true);
    expect(after?.termsVersion).toBeNull();
    expect(after?.termsAcceptedAt).toBeNull();
  });

  it("does not touch terms acceptance when an already-verified account signs in", async () => {
    const email = uniqueEmail("already-verified");
    createdEmails.push(email);
    const headers = testRequestHeaders();
    // Verification itself clears terms acceptance (the test above), so this
    // account is walked through the whole flow, including the re-acceptance
    // gate, before the sign-in under test.
    await registerVerifiedUser(
      { name: "Already Verified User", email, password: "correct-horse-battery" },
      headers,
    );
    const [verifiedUser] = await getDb().select().from(user).where(eq(user.email, email));
    if (!verifiedUser) {
      throw new Error("registerVerifiedUser did not create a row");
    }
    await acceptTerms(getDb(), verifiedUser, { name: verifiedUser.name });

    const [before] = await getDb().select().from(user).where(eq(user.email, email));
    expect(before?.termsVersion).toBe(CURRENT_TERMS_VERSION);
    expect(before?.emailVerified).toBe(true);

    const signInOutcome = await signIn(
      { email, password: "correct-horse-battery" },
      testRequestHeaders(),
    );
    expect(signInOutcome.status).toBe("ok");

    const [after] = await getDb().select().from(user).where(eq(user.email, email));
    expect(after?.termsVersion).toBe(CURRENT_TERMS_VERSION);
    expect(after?.termsAcceptedAt?.getTime()).toBe(before?.termsAcceptedAt?.getTime());
  });
});
