import { execFileSync } from "node:child_process";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";

import { getAuth } from "./auth";
import { hasPassword } from "./credential";
import { isOwnerEmail } from "./owner";
import { account, session, termsAcceptances, user } from "./schema";
import { signInMagicLink } from "./service";
import { testRequestHeaders } from "./test-support";
import { CURRENT_TERMS_VERSION } from "./terms";
import { readTermsGate } from "./terms-gate";
import { findLatestVerificationLink } from "./verification-link";

const scriptPath = path.resolve(import.meta.dirname, "../../../scripts/seed-e2e-owner.mjs");

function uniqueEmail(): string {
  return `fetha-e2e-owner-${crypto.randomUUID()}@example.com`;
}

function runSeed(email: string): void {
  execFileSync("node", [scriptPath], {
    env: { ...process.env, E2E_OWNER_EMAIL: email },
    stdio: "pipe",
  });
}

async function loadSeededUser(email: string) {
  const [row] = await getDb()
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
    })
    .from(user)
    .where(eq(user.email, email));
  if (!row) {
    throw new Error(`seed-e2e-owner.mjs created no user for ${email}`);
  }
  return row;
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("seed-e2e-owner.mjs", () => {
  it("provisions a verified account on the current terms that the shell lets through", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);

    runSeed(email);

    const seeded = await loadSeededUser(email);
    expect(seeded.emailVerified).toBe(true);
    expect(await readTermsGate(getDb(), seeded)).toEqual({ state: "current" });
    expect(await hasPassword(getDb(), seeded)).toBe(true);
    expect(isOwnerEmail(seeded, { OWNER_EMAILS: email })).toBe(true);

    const acceptances = await getDb()
      .select({ termsVersion: termsAcceptances.termsVersion })
      .from(termsAcceptances)
      .where(eq(termsAcceptances.userId, seeded.id));
    expect(acceptances).toEqual([{ termsVersion: CURRENT_TERMS_VERSION }]);
  });

  it("signs in through a magic link, the way the owner-gated e2e specs do", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);
    runSeed(email);
    const headers = testRequestHeaders();

    const outcome = await signInMagicLink({ email }, headers);
    expect(outcome.status).toBe("ok");

    const link = await findLatestVerificationLink(getDb(), email);
    if (!link) {
      throw new Error(`no magic link was captured for ${email}`);
    }
    const response = await getAuth().handler(new Request(link, { method: "GET", headers }));

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("location")).not.toContain("error");
    expect(response.headers.get("set-cookie")).toBeTruthy();
  });

  it("is idempotent: a second run keeps one user, one credential and one acceptance", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);

    runSeed(email);
    const first = await loadSeededUser(email);
    runSeed(email);
    const second = await loadSeededUser(email);

    expect(second.id).toBe(first.id);
    const credentials = await getDb()
      .select({ id: account.id })
      .from(account)
      .where(eq(account.userId, first.id));
    expect(credentials).toHaveLength(1);
    const acceptances = await getDb()
      .select({ id: termsAcceptances.id })
      .from(termsAcceptances)
      .where(eq(termsAcceptances.userId, first.id));
    expect(acceptances).toHaveLength(1);
  });

  it("takes over an address someone registered first: their password and sessions stop working", async () => {
    const email = uniqueEmail();
    createdEmails.push(email);
    const squatterId = crypto.randomUUID();
    await getDb().insert(user).values({
      id: squatterId,
      name: "Squatter",
      email,
      emailVerified: false,
      termsVersion: CURRENT_TERMS_VERSION,
      termsAcceptedAt: new Date(),
    });
    await getDb().insert(account).values({
      id: crypto.randomUUID(),
      accountId: squatterId,
      providerId: "credential",
      userId: squatterId,
      password: "squatter-known-hash",
    });
    await getDb()
      .insert(session)
      .values({
        id: crypto.randomUUID(),
        token: crypto.randomUUID(),
        userId: squatterId,
        expiresAt: new Date(Date.now() + 60_000),
      });

    runSeed(email);

    const credentials = await getDb()
      .select({ password: account.password })
      .from(account)
      .where(eq(account.userId, squatterId));
    expect(credentials).toHaveLength(1);
    expect(credentials[0]?.password).not.toBe("squatter-known-hash");
    const sessions = await getDb()
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, squatterId));
    expect(sessions).toEqual([]);
  });
});
