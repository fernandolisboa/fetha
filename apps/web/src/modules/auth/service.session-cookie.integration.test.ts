import { afterEach, describe, expect, it, vi } from "vitest";

const cookieStore = {
  set: vi.fn<(name: string, value: string, options?: Record<string, unknown>) => void>(),
};

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve(cookieStore),
}));

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";

import { getAuth } from "./auth";
import { signIn, signUp } from "./service";
import { testRequestHeaders } from "./test-support";
import { findLatestVerificationLink } from "./verification-link";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.REGISTRATION_MODE = "open";

function uniqueEmail(label: string): string {
  return `fetha-auth-cookie-${label}-${crypto.randomUUID()}@example.com`;
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

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("session cookie forwarding through the Server Action code path", () => {
  it("forwards the Better Auth session cookie to the browser on sign-in", async () => {
    const testHeaders = testRequestHeaders();
    const email = uniqueEmail("sign-in");
    createdEmails.push(email);

    const signUpOutcome = await signUp(
      {
        name: "Cookie Forward",
        email,
        password: "correct-horse-battery",
        termsAccepted: true,
        privacyAccepted: true,
      },
      testHeaders,
    );
    expect(signUpOutcome.status).toBe("ok");
    await verifyEmail(email);

    cookieStore.set.mockClear();
    const outcome = await signIn({ email, password: "correct-horse-battery" }, testHeaders);

    expect(outcome.status).toBe("ok");
    expect(cookieStore.set).toHaveBeenCalled();
    const [cookieName, cookieValue] = cookieStore.set.mock.calls[0] ?? [];
    expect(cookieName).toMatch(/session_token/);
    expect(cookieValue).toBeTruthy();
  });

  it("does not attempt to forward a cookie when sign-in fails", async () => {
    cookieStore.set.mockClear();

    const outcome = await signIn(
      { email: "no-such-user@example.com", password: "wrong-password" },
      testRequestHeaders(),
    );

    expect(outcome.status).not.toBe("ok");
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});
