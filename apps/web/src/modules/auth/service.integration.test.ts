import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { invites, mailOutbox, session, user } from "./schema";
import { deleteTestInvite, deleteTestUser } from "@/db/test/cleanup";

import { getAuth } from "./auth";
import { resendVerification, signIn, signOut, signUp } from "./service";
import { testRequestHeaders, uniqueTestIp } from "./test-support";
import { findLatestVerificationLink } from "./verification-link";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

function uniqueEmail(label: string): string {
  return `fetha-auth-${label}-${crypto.randomUUID()}@example.com`;
}

async function extractVerificationToken(email: string): Promise<string> {
  const link = await findLatestVerificationLink(getDb(), email);
  if (!link) {
    throw new Error(`no email was captured for ${email}`);
  }
  const token = new URL(link).searchParams.get("token");
  if (!token) {
    throw new Error("verification link did not contain a token");
  }
  return token;
}

async function verifyEmail(email: string): Promise<void> {
  const token = await extractVerificationToken(email);
  await getAuth().api.verifyEmail({ query: { token } });
}

const createdEmails: string[] = [];
const createdInviteEmails: string[] = [];

beforeEach(() => {
  process.env.REGISTRATION_MODE = "open";
});

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
  for (const email of createdInviteEmails.splice(0)) {
    await deleteTestInvite(db, email);
  }
});

describe("registration, verification, login, logout and session expiry", () => {
  it("refuses a user row with no termsVersion at the database level", async () => {
    const email = uniqueEmail("no-terms-column");
    createdEmails.push(email);

    await expect(
      getDb()
        .insert(user)
        .values({
          id: crypto.randomUUID(),
          name: "No Terms Column",
          email,
          emailVerified: true,
        } as unknown as typeof user.$inferInsert),
    ).rejects.toThrow();
  });
  it("registers, verifies and signs in in open mode", async () => {
    const testHeaders = testRequestHeaders();
    const email = uniqueEmail("open");
    createdEmails.push(email);

    const outcome = await signUp(
      {
        name: "Nova User",
        email,
        password: "correct-horse-battery",
        termsAccepted: true,
        privacyAccepted: true,
      },
      testHeaders,
    );
    expect(outcome.status).toBe("ok");

    await verifyEmail(email);

    const signInOutcome = await signIn({ email, password: "correct-horse-battery" }, testHeaders);
    expect(signInOutcome.status).toBe("ok");
  });
  it("refuses registration when REGISTRATION_MODE is closed, creating no user", async () => {
    const testHeaders = testRequestHeaders();
    process.env.REGISTRATION_MODE = "closed";
    const email = uniqueEmail("closed");
    createdEmails.push(email);

    const outcome = await signUp(
      {
        name: "Closed Mode",
        email,
        password: "correct-horse-battery",
        termsAccepted: true,
        privacyAccepted: true,
      },
      testHeaders,
    );
    expect(outcome.status).toBe("registration_closed");

    const rows = await getDb().select().from(user).where(eq(user.email, email));
    expect(rows).toHaveLength(0);
  });
  it("returns the same generic outcome for a non-invited email in invite mode, creating no user", async () => {
    const testHeaders = testRequestHeaders();
    process.env.REGISTRATION_MODE = "invite";
    const email = uniqueEmail("no-invite");
    createdEmails.push(email);

    const outcome = await signUp(
      {
        name: "No Invite",
        email,
        password: "correct-horse-battery",
        termsAccepted: true,
        privacyAccepted: true,
      },
      testHeaders,
    );

    expect(outcome.status).toBe("ok");
    const rows = await getDb().select().from(user).where(eq(user.email, email));
    expect(rows).toHaveLength(0);
  });
  it("registers in invite mode with a pending invite and consumes it", async () => {
    const testHeaders = testRequestHeaders();
    process.env.REGISTRATION_MODE = "invite";
    const email = uniqueEmail("invited");
    createdEmails.push(email);
    createdInviteEmails.push(email);

    await getDb().insert(invites).values({ email });

    const outcome = await signUp(
      {
        name: "Invited User",
        email,
        password: "correct-horse-battery",
        termsAccepted: true,
        privacyAccepted: true,
      },
      testHeaders,
    );
    expect(outcome.status).toBe("ok");

    const [invite] = await getDb().select().from(invites).where(eq(invites.email, email));
    expect(invite).toBeDefined();
    expect(invite?.consumedAt).not.toBeNull();
  });
  it("refuses registration without accepting the terms", async () => {
    const testHeaders = testRequestHeaders();
    const email = uniqueEmail("no-terms");
    createdEmails.push(email);

    const outcome = await signUp(
      {
        name: "No Terms",
        email,
        password: "correct-horse-battery",
        termsAccepted: false,
        privacyAccepted: true,
      },
      testHeaders,
    );
    expect(outcome.status).toBe("terms_not_accepted");
  });
  it("refuses registration without accepting the privacy policy", async () => {
    const testHeaders = testRequestHeaders();
    const email = uniqueEmail("no-privacy");
    createdEmails.push(email);

    const outcome = await signUp(
      {
        name: "No Privacy",
        email,
        password: "correct-horse-battery",
        termsAccepted: true,
        privacyAccepted: false,
      },
      testHeaders,
    );
    expect(outcome.status).toBe("terms_not_accepted");

    const rows = await getDb().select().from(user).where(eq(user.email, email));
    expect(rows).toHaveLength(0);
  });
  it("refuses a direct sign-up POST that accepts terms but not privacy, creating no user", async () => {
    const email = uniqueEmail("direct-no-privacy");
    createdEmails.push(email);

    const response = await getAuth().handler(
      new Request(new URL("/api/auth/sign-up/email", process.env.BETTER_AUTH_URL), {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": uniqueTestIp() },
        body: JSON.stringify({
          name: "Direct No Privacy",
          email,
          password: "correct-horse-battery",
          termsAccepted: true,
        }),
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toBe("privacy_not_accepted");

    const rows = await getDb().select().from(user).where(eq(user.email, email));
    expect(rows).toHaveLength(0);
  });
  it("returns the same generic outcome on a duplicate email, creating exactly one user row", async () => {
    const testHeaders = testRequestHeaders();
    const email = uniqueEmail("duplicate");
    createdEmails.push(email);

    const first = await signUp(
      {
        name: "First",
        email,
        password: "correct-horse-battery",
        termsAccepted: true,
        privacyAccepted: true,
      },
      testHeaders,
    );
    const second = await signUp(
      {
        name: "Second",
        email,
        password: "another-password-here",
        termsAccepted: true,
        privacyAccepted: true,
      },
      testHeaders,
    );

    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");

    const rows = await getDb().select().from(user).where(eq(user.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("First");

    const mail = await getDb().select().from(mailOutbox).where(eq(mailOutbox.to, email));
    expect(mail).toHaveLength(1);
  });
  it("refuses a direct sign-up whose name spans lines or carries a link", async () => {
    const email = uniqueEmail("direct-bad-name");
    createdEmails.push(email);

    const response = await getAuth().handler(
      new Request(new URL("/api/auth/sign-up/email", process.env.BETTER_AUTH_URL), {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": uniqueTestIp() },
        body: JSON.stringify({
          name: "cliente.\n\nSua conta foi bloqueada, regularize em http://evil.example",
          email,
          password: "correct-horse-battery",
          termsAccepted: true,
          privacyAccepted: true,
        }),
      }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toBe("invalid_name");

    const rows = await getDb().select().from(user).where(eq(user.email, email));
    expect(rows).toHaveLength(0);
    const mail = await getDb().select().from(mailOutbox).where(eq(mailOutbox.to, email));
    expect(mail).toHaveLength(0);
  });
  it("refuses sign-in for an unverified user", async () => {
    const testHeaders = testRequestHeaders();
    const email = uniqueEmail("unverified");
    createdEmails.push(email);

    await signUp(
      {
        name: "Unverified",
        email,
        password: "correct-horse-battery",
        termsAccepted: true,
        privacyAccepted: true,
      },
      testHeaders,
    );

    const outcome = await signIn({ email, password: "correct-horse-battery" }, testHeaders);
    expect(outcome.status).toBe("email_not_verified");
  });
  it("resends the verification email", async () => {
    const testHeaders = testRequestHeaders();
    const email = uniqueEmail("resend");
    createdEmails.push(email);

    await signUp(
      {
        name: "Resend",
        email,
        password: "correct-horse-battery",
        termsAccepted: true,
        privacyAccepted: true,
      },
      testHeaders,
    );

    const outcome = await resendVerification(email, testHeaders);
    expect(outcome.status).toBe("ok");
  });
  it("signs out, clearing the session", async () => {
    const testHeaders = testRequestHeaders();
    const email = uniqueEmail("logout");
    createdEmails.push(email);

    await signUp(
      {
        name: "Logout",
        email,
        password: "correct-horse-battery",
        termsAccepted: true,
        privacyAccepted: true,
      },
      testHeaders,
    );
    await verifyEmail(email);

    const signInResponse = await getAuth().api.signInEmail({
      body: { email, password: "correct-horse-battery" },
      asResponse: true,
    });
    const cookie = signInResponse.headers.get("set-cookie");
    expect(cookie).toBeTruthy();

    const headers = new Headers({ cookie: cookie ?? "" });
    const sessionBefore = await getAuth().api.getSession({ headers });
    expect(sessionBefore).not.toBeNull();

    await signOut(headers);

    const [dbUser] = await getDb().select().from(user).where(eq(user.email, email));
    expect(dbUser).toBeDefined();
    if (!dbUser) throw new Error("user row missing after sign-up");

    const rows = await getDb().select().from(session).where(eq(session.userId, dbUser.id));
    expect(rows).toHaveLength(0);
  });
  it("treats an expired session as unauthenticated", async () => {
    const testHeaders = testRequestHeaders();
    const email = uniqueEmail("expiry");
    createdEmails.push(email);

    await signUp(
      {
        name: "Expiry",
        email,
        password: "correct-horse-battery",
        termsAccepted: true,
        privacyAccepted: true,
      },
      testHeaders,
    );
    await verifyEmail(email);

    const signInResponse = await getAuth().api.signInEmail({
      body: { email, password: "correct-horse-battery" },
      asResponse: true,
    });
    const cookie = signInResponse.headers.get("set-cookie");
    const headers = new Headers({ cookie: cookie ?? "" });

    const [dbUser] = await getDb().select().from(user).where(eq(user.email, email));
    if (!dbUser) throw new Error("user row missing after sign-up");

    await getDb()
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(session.userId, dbUser.id));

    const expiredSession = await getAuth().api.getSession({ headers });
    expect(expiredSession).toBeNull();
  });
});
