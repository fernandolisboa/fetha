import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { user, verification } from "./schema";
import { deleteTestUser } from "@/db/test/cleanup";

import { getAuth } from "./auth";
import { registerVerifiedUser as registerUser } from "./registration-test-support";
import { signIn, signInMagicLink } from "./service";
import { storedIdentifier, testRequestHeaders } from "./test-support";
import { findLatestVerificationLink } from "./verification-link";

function uniqueEmail(label: string): string {
  return `fetha-magic-link-${label}-${crypto.randomUUID()}@example.com`;
}

function registerVerifiedUser(email: string, headers: Headers): Promise<void> {
  return registerUser(
    { name: "Magic Link User", email, password: "correct-horse-battery" },
    headers,
  );
}

async function captureMagicLinkUrl(email: string): Promise<URL> {
  const link = await findLatestVerificationLink(getDb(), email);
  if (!link) {
    throw new Error(`no magic link was captured for ${email}`);
  }
  return new URL(link);
}

// The plugin hashes the token (`storeToken: "hashed"`) and the verification
// store hashes that again (`storeIdentifier: "hashed"`).
function magicLinkStoredIdentifier(token: string): string {
  return storedIdentifier(storedIdentifier(token));
}

async function expireMagicLinkToken(token: string): Promise<void> {
  const expired = await getDb()
    .update(verification)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(verification.identifier, magicLinkStoredIdentifier(token)))
    .returning({ id: verification.id });
  if (expired.length !== 1) {
    throw new Error("no stored token row matched the hashed identifier");
  }
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

describe("magic link sign-in", () => {
  it("signs an existing, verified user in and sets a session cookie", async () => {
    const email = uniqueEmail("sign-in");
    createdEmails.push(email);
    const headers = testRequestHeaders();
    await registerVerifiedUser(email, headers);

    const outcome = await signInMagicLink({ email }, headers);
    expect(outcome.status).toBe("ok");

    const url = await captureMagicLinkUrl(email);
    const response = await getAuth().handler(new Request(url, { method: "GET", headers }));

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("location")).not.toContain("error");
    expect(response.headers.get("set-cookie")).toBeTruthy();
  });

  it("stores the magic link token only as a hash", async () => {
    const email = uniqueEmail("hashed");
    createdEmails.push(email);
    const headers = testRequestHeaders();
    await registerVerifiedUser(email, headers);

    await signInMagicLink({ email }, headers);
    const token = (await captureMagicLinkUrl(email)).searchParams.get("token") ?? "";

    const plain = await getDb()
      .select()
      .from(verification)
      .where(eq(verification.identifier, token));
    const hashed = await getDb()
      .select()
      .from(verification)
      .where(eq(verification.identifier, magicLinkStoredIdentifier(token)));
    expect(token).not.toBe("");
    expect(plain).toHaveLength(0);
    expect(hashed).toHaveLength(1);
  });

  it("rejects a reused magic link token", async () => {
    const email = uniqueEmail("reuse");
    createdEmails.push(email);
    const headers = testRequestHeaders();
    await registerVerifiedUser(email, headers);

    await signInMagicLink({ email }, headers);
    const url = await captureMagicLinkUrl(email);

    const first = await getAuth().handler(new Request(url, { method: "GET", headers }));
    expect(first.headers.get("location")).not.toContain("error");

    const second = await getAuth().handler(new Request(url, { method: "GET", headers }));
    expect(second.headers.get("location")).toContain("error");
  });

  it("rejects an expired magic link token", async () => {
    const email = uniqueEmail("expired");
    createdEmails.push(email);
    const headers = testRequestHeaders();
    await registerVerifiedUser(email, headers);

    await signInMagicLink({ email }, headers);
    const url = await captureMagicLinkUrl(email);
    const token = url.searchParams.get("token");
    if (!token) {
      throw new Error("magic link did not contain a token");
    }
    await expireMagicLinkToken(token);

    const response = await getAuth().handler(new Request(url, { method: "GET", headers }));
    expect(response.headers.get("location")).toContain("error");
  });

  it("sends no mail and creates no account for an email with no existing user", async () => {
    const email = uniqueEmail("no-account");
    createdEmails.push(email);
    const headers = testRequestHeaders();

    // No enumeration (docs/adr/0018): the outward response for an
    // unregistered email is identical to a real one, but nothing is ever
    // sent and no account is ever created through this endpoint.
    const outcome = await signInMagicLink({ email }, headers);
    expect(outcome.status).toBe("ok");

    const link = await findLatestVerificationLink(getDb(), email);
    expect(link).toBeUndefined();

    const rows = await getDb().select().from(user).where(eq(user.email, email));
    expect(rows).toHaveLength(0);
  });

  it("does not require a password to sign in once verified through the magic link", async () => {
    const email = uniqueEmail("no-password-needed");
    createdEmails.push(email);
    const headers = testRequestHeaders();
    await registerVerifiedUser(email, headers);

    const wrongPasswordOutcome = await signIn(
      { email, password: "definitely-not-the-password" },
      headers,
    );
    expect(wrongPasswordOutcome.status).toBe("invalid_credentials");

    const outcome = await signInMagicLink({ email }, headers);
    expect(outcome.status).toBe("ok");
  });
});
