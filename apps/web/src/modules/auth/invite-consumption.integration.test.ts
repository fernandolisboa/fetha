import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { deleteTestInvite, deleteTestUser } from "@/db/test/cleanup";

import { getAuth } from "./auth";
import { hasPendingInvite } from "./invite-repository";
import { openVerificationLink } from "./registration-test-support";
import { invites, mailOutbox, user } from "./schema";
import { requestPasswordReset, resetPassword, signInMagicLink, signUp } from "./service";
import { testRequestHeaders } from "./test-support";
import { findLatestVerificationLink } from "./verification-link";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

function uniqueEmail(label: string): string {
  return `fetha-invite-${label}-${crypto.randomUUID()}@example.com`;
}

const createdEmails: string[] = [];

beforeEach(() => {
  process.env.REGISTRATION_MODE = "invite";
});

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
    await deleteTestInvite(db, email);
  }
});

async function invite(label: string): Promise<string> {
  const email = uniqueEmail(label);
  createdEmails.push(email);
  await getDb().insert(invites).values({ email });
  return email;
}

function register(email: string, name: string) {
  return signUp({ name, email, termsAccepted: true, privacyAccepted: true }, testRequestHeaders());
}

async function readInvite(email: string) {
  const [row] = await getDb().select().from(invites).where(eq(invites.email, email));
  return row;
}

async function userId(email: string): Promise<string | undefined> {
  const [row] = await getDb().select({ id: user.id }).from(user).where(eq(user.email, email));
  return row?.id;
}

async function clearOutbox(email: string): Promise<void> {
  await getDb().delete(mailOutbox).where(eq(mailOutbox.to, email));
}

async function openLatestLink(email: string): Promise<Response> {
  const link = await findLatestVerificationLink(getDb(), email);
  if (!link) {
    throw new Error(`no link was captured for ${email}`);
  }
  return getAuth().handler(new Request(link));
}

async function resetThroughEmailedLink(email: string, newPassword: string): Promise<string> {
  await requestPasswordReset({ email }, testRequestHeaders());
  const callback = await openLatestLink(email);
  const location = callback.headers.get("location");
  const token = location ? new URL(location, "http://localhost").searchParams.get("token") : null;
  if (!token) {
    throw new Error("reset-password callback did not carry a token");
  }
  return (await resetPassword({ token, newPassword }, testRequestHeaders())).status;
}

describe("invite consumption (#39)", () => {
  it("keeps the invite pending when someone registers the invited email without proving the mailbox", async () => {
    const email = await invite("stranger-first");

    expect((await register(email, "Mallory")).status).toBe("ok");

    const row = await readInvite(email);
    expect(row?.consumedAt).toBeNull();
    expect(row?.consumedByUserId).toBeNull();
    expect(await hasPendingInvite(getDb(), email)).toBe(true);
  });

  it("lets the invitee complete the account a stranger started, and spends the invite then", async () => {
    const email = await invite("invitee-completes");
    await register(email, "Mallory");
    await clearOutbox(email);

    expect((await register(email, "Invitee")).status).toBe("ok");
    await openVerificationLink(email);

    const row = await readInvite(email);
    expect(row?.consumedAt).not.toBeNull();
    expect(row?.consumedByUserId).toBe(await userId(email));
  });

  it("spends the invite when the mailbox is proven by a magic link", async () => {
    const email = await invite("magic-link");
    await register(email, "Invitee");
    await clearOutbox(email);

    expect((await signInMagicLink({ email }, testRequestHeaders())).status).toBe("ok");
    const response = await openLatestLink(email);
    expect(response.headers.get("location")).not.toContain("error");

    const row = await readInvite(email);
    expect(row?.consumedByUserId).toBe(await userId(email));
  });

  it("spends the invite when the mailbox is proven by a password reset", async () => {
    const email = await invite("reset");
    await register(email, "Invitee");
    await clearOutbox(email);

    expect(await resetThroughEmailedLink(email, "the-invitees-password")).toBe("ok");

    const row = await readInvite(email);
    expect(row?.consumedByUserId).toBe(await userId(email));
  });

  it("refuses to spend an invite twice", async () => {
    const email = await invite("reuse");
    await register(email, "Invitee");
    await openVerificationLink(email);
    const first = await readInvite(email);

    expect(await hasPendingInvite(getDb(), email)).toBe(false);
    await clearOutbox(email);
    expect(await resetThroughEmailedLink(email, "another-proof-of-mailbox")).toBe("ok");
    const second = await readInvite(email);
    expect(second?.consumedAt).toEqual(first?.consumedAt);
    expect(second?.consumedByUserId).toBe(first?.consumedByUserId);
  });
});
