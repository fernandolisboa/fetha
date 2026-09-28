import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { invites, mailOutbox, session, user } from "./schema";
import { deleteTestInvite, deleteTestUser } from "@/db/test/cleanup";

import { getAuth } from "./auth";
import { openVerificationLink, registerVerifiedUser } from "./registration-test-support";
import { resendVerification, signIn, signOut, signUp } from "./service";
import { testRequestHeaders, uniqueTestIp } from "./test-support";

function uniqueEmail(label: string): string {
  return `fetha-auth-${label}-${crypto.randomUUID()}@example.com`;
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
  // `termsVersion`/`termsAcceptedAt` are nullable at the database level since
  // docs/adr/0036 (a verified account whose owner has not accepted the
  // current terms yet), so the invariant that no live sign-up ever produces
  // one is enforced by `databaseHooks.user.create.before`
  // (`buildUserCreateOverrides`, covered by options.test.ts), not by a NOT
  // NULL column.
  it("allows a bare user row with no termsVersion, now that only a verified account may carry one", async () => {
    const email = uniqueEmail("no-terms-column");
    createdEmails.push(email);

    const [row] = await getDb()
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: "No Terms Column",
        email,
        emailVerified: true,
      })
      .returning({ termsVersion: user.termsVersion });

    expect(row?.termsVersion).toBeNull();
  });
  it("registers, verifies and signs in in open mode", async () => {
    const testHeaders = testRequestHeaders();
    const email = uniqueEmail("open");
    createdEmails.push(email);

    await registerVerifiedUser(
      { name: "Nova User", email, password: "correct-horse-battery" },
      testHeaders,
    );

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
        termsAccepted: true,
        privacyAccepted: true,
      },
      testHeaders,
    );

    expect(outcome.status).toBe("ok");
    const rows = await getDb().select().from(user).where(eq(user.email, email));
    expect(rows).toHaveLength(0);
  });
  it("registers in invite mode with a pending invite, and verification consumes it", async () => {
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
        termsAccepted: true,
        privacyAccepted: true,
      },
      testHeaders,
    );
    expect(outcome.status).toBe("ok");
    const [pending] = await getDb().select().from(invites).where(eq(invites.email, email));
    expect(pending?.consumedAt).toBeNull();

    await openVerificationLink(email);

    const [invite] = await getDb().select().from(invites).where(eq(invites.email, email));
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
  it("returns the same generic outcome on a verified email, keeping its one user row", async () => {
    const testHeaders = testRequestHeaders();
    const email = uniqueEmail("duplicate");
    createdEmails.push(email);

    await registerVerifiedUser(
      { name: "First", email, password: "correct-horse-battery" },
      testHeaders,
    );
    const second = await signUp(
      { name: "Second", email, termsAccepted: true, privacyAccepted: true },
      testHeaders,
    );

    expect(second.status).toBe("ok");

    const rows = await getDb().select().from(user).where(eq(user.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("First");

    const mail = await getDb().select().from(mailOutbox).where(eq(mailOutbox.to, email));
    expect(mail).toHaveLength(0);
  });
  it.each([
    [
      "spans lines and carries a link",
      "cliente.\n\nSua conta foi bloqueada, regularize em http://evil.example",
    ],
    ["hides line breaks at its edges", "\n\nSua conta foi bloqueada\n"],
  ])("refuses a direct sign-up whose name %s", async (_label, name) => {
    const email = uniqueEmail("direct-bad-name");
    createdEmails.push(email);

    const response = await getAuth().handler(
      new Request(new URL("/api/auth/sign-up/email", process.env.BETTER_AUTH_URL), {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": uniqueTestIp() },
        body: JSON.stringify({
          name,
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

    // Only a direct POST knows the password of an unverified account: the
    // form sends none (docs/adr/0016, #144).
    await getAuth().handler(
      new Request(new URL("/api/auth/sign-up/email", process.env.BETTER_AUTH_URL), {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": uniqueTestIp() },
        body: JSON.stringify({
          name: "Unverified",
          email,
          password: "correct-horse-battery",
          termsAccepted: true,
          privacyAccepted: true,
        }),
      }),
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

    await registerVerifiedUser(
      { name: "Logout", email, password: "correct-horse-battery" },
      testHeaders,
    );

    const signInResponse = await getAuth().api.signInEmail({
      body: { email, password: "correct-horse-battery" },
      asResponse: true,
    });
    const cookie = signInResponse.headers.get("set-cookie");
    expect(cookie).toBeTruthy();

    const headers = new Headers({ cookie: cookie ?? "" });
    const sessionBefore = await getAuth().api.getSession({ headers });
    expect(sessionBefore).not.toBeNull();

    const [dbUser] = await getDb().select().from(user).where(eq(user.email, email));
    if (!dbUser) throw new Error("user row missing after sign-up");
    const rowsBefore = await getDb().select().from(session).where(eq(session.userId, dbUser.id));

    await signOut(headers);

    expect(await getAuth().api.getSession({ headers })).toBeNull();
    const rowsAfter = await getDb().select().from(session).where(eq(session.userId, dbUser.id));
    expect(rowsAfter).toHaveLength(rowsBefore.length - 1);
  });
  it("treats an expired session as unauthenticated", async () => {
    const testHeaders = testRequestHeaders();
    const email = uniqueEmail("expiry");
    createdEmails.push(email);

    await registerVerifiedUser(
      { name: "Expiry", email, password: "correct-horse-battery" },
      testHeaders,
    );

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
