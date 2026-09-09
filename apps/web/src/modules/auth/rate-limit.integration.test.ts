import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { rateLimit } from "@/db/schema/rate-limits";
import { deleteTestUser } from "@/db/test/cleanup";

import { getAuth } from "./auth";
import { requestPasswordReset, signIn, signInMagicLink } from "./service";
import { testRequestHeaders, uniqueTestIp } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

function uniqueEmail(label: string): string {
  return `fetha-rate-limit-${label}-${crypto.randomUUID()}@example.com`;
}

const createdRateLimitKeys: string[] = [];
const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const key of createdRateLimitKeys.splice(0)) {
    await db.delete(rateLimit).where(eq(rateLimit.key, key));
  }
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

function attemptSignIn(email: string, headers: Headers) {
  return signIn({ email, password: "wrong-password" }, headers);
}

// Backdates a counter row past its window instead of sleeping through the
// real window (the send-verification/request-password-reset rule is a full
// minute), so the "resets once the window elapses" behavior is exercised
// deterministically and fast.
async function expireRateLimitKey(key: string, windowSeconds: number): Promise<void> {
  const db = getDb();
  await db
    .update(rateLimit)
    .set({ lastRequest: Date.now() - (windowSeconds * 1000 + 1000) })
    .where(eq(rateLimit.key, key));
}

describe("database-backed rate limiting on auth endpoints", () => {
  it("rejects a client after it exceeds the sign-in limit, from a single shared IP", async () => {
    const ip = uniqueTestIp();
    const headers = testRequestHeaders(ip);
    const email = uniqueEmail("shared-ip");
    createdRateLimitKeys.push(`${ip}|/sign-in/email`, `${email}|/sign-in/email`);

    // The configured rule (options.ts, RATE_LIMIT_CUSTOM_RULES) is
    // window: 10, max: 3.
    const outcomes = [];
    for (let i = 0; i < 4; i += 1) {
      outcomes.push(await attemptSignIn(email, headers));
    }

    expect(outcomes.slice(0, 3).every((outcome) => outcome.status !== "rate_limited")).toBe(true);
    expect(outcomes[3]?.status).toBe("rate_limited");
  });

  it("does not rate-limit a different client (different IP and account) on the same endpoint", async () => {
    const ip = uniqueTestIp();
    const headers = testRequestHeaders(ip);
    const email = uniqueEmail("client-a");
    createdRateLimitKeys.push(`${ip}|/sign-in/email`, `${email}|/sign-in/email`);

    for (let i = 0; i < 3; i += 1) {
      await attemptSignIn(email, headers);
    }

    const otherIp = uniqueTestIp();
    const otherHeaders = testRequestHeaders(otherIp);
    const otherEmail = uniqueEmail("client-b");
    createdRateLimitKeys.push(`${otherIp}|/sign-in/email`, `${otherEmail}|/sign-in/email`);

    const outcome = await attemptSignIn(otherEmail, otherHeaders);
    expect(outcome.status).not.toBe("rate_limited");
  });

  // A-01 remediation (docs/security-audit/2026-09-09.md): limiting by IP
  // alone lets a distributed attacker rotate IPs against one account
  // unbounded. The account-level bucket (keyed by email, docs/adr/0016)
  // catches that: two different IPs against the same email still hit the
  // shared account cap.
  it("rejects a client hitting the account limit across two different IPs for the same email", async () => {
    const email = uniqueEmail("cross-ip");
    const firstIp = uniqueTestIp();
    const secondIp = uniqueTestIp();
    createdRateLimitKeys.push(
      `${firstIp}|/sign-in/email`,
      `${secondIp}|/sign-in/email`,
      `${email}|/sign-in/email`,
    );

    const outcomes = [];
    outcomes.push(await attemptSignIn(email, testRequestHeaders(firstIp)));
    outcomes.push(await attemptSignIn(email, testRequestHeaders(secondIp)));
    outcomes.push(await attemptSignIn(email, testRequestHeaders(firstIp)));
    // Every attempt so far used a fresh IP/account pair below the IP cap
    // (max 3), so none of them should have been blocked by IP alone.
    expect(outcomes.every((outcome) => outcome.status !== "rate_limited")).toBe(true);

    const limited = await attemptSignIn(email, testRequestHeaders(secondIp));
    expect(limited.status).toBe("rate_limited");
  });

  it("resets the sign-in limit once the window has elapsed", async () => {
    const ip = uniqueTestIp();
    const headers = testRequestHeaders(ip);
    const email = uniqueEmail("window-reset");
    createdRateLimitKeys.push(`${ip}|/sign-in/email`, `${email}|/sign-in/email`);

    for (let i = 0; i < 3; i += 1) {
      await attemptSignIn(email, headers);
    }
    const limited = await attemptSignIn(email, headers);
    expect(limited.status).toBe("rate_limited");

    await expireRateLimitKey(`${ip}|/sign-in/email`, 10);
    await expireRateLimitKey(`${email}|/sign-in/email`, 10);

    const afterReset = await attemptSignIn(email, headers);
    expect(afterReset.status).not.toBe("rate_limited");
  });

  it("keeps sign-in and magic-link counters independent for the same IP", async () => {
    const ip = uniqueTestIp();
    const headers = testRequestHeaders(ip);
    const signInEmail = uniqueEmail("sign-in-bucket");
    const magicLinkEmail = uniqueEmail("magic-link-bucket");
    createdRateLimitKeys.push(
      `${ip}|/sign-in/email`,
      `${signInEmail}|/sign-in/email`,
      `${ip}|/sign-in/magic-link`,
      `${magicLinkEmail}|/sign-in/magic-link`,
    );

    for (let i = 0; i < 3; i += 1) {
      await attemptSignIn(signInEmail, headers);
    }
    const limited = await attemptSignIn(signInEmail, headers);
    expect(limited.status).toBe("rate_limited");

    const magicLinkOutcome = await signInMagicLink({ email: magicLinkEmail }, headers);
    expect(magicLinkOutcome.status).not.toBe("rate_limited");
  });

  it("rejects a magic-link client after it exceeds that endpoint's own limit", async () => {
    const ip = uniqueTestIp();
    const headers = testRequestHeaders(ip);
    const email = uniqueEmail("magic-link-limit");
    createdRateLimitKeys.push(`${ip}|/sign-in/magic-link`, `${email}|/sign-in/magic-link`);

    // The magic-link plugin's own rule (options.ts) is window: 60, max: 3.
    const outcomes = [];
    for (let i = 0; i < 4; i += 1) {
      outcomes.push(await signInMagicLink({ email }, headers));
    }

    expect(outcomes.slice(0, 3).every((outcome) => outcome.status !== "rate_limited")).toBe(true);
    expect(outcomes[3]?.status).toBe("rate_limited");
  });

  it("resets the magic-link limit once its window has elapsed", async () => {
    const ip = uniqueTestIp();
    const headers = testRequestHeaders(ip);
    const email = uniqueEmail("magic-link-window-reset");
    createdRateLimitKeys.push(`${ip}|/sign-in/magic-link`, `${email}|/sign-in/magic-link`);

    for (let i = 0; i < 3; i += 1) {
      await signInMagicLink({ email }, headers);
    }
    const limited = await signInMagicLink({ email }, headers);
    expect(limited.status).toBe("rate_limited");

    await expireRateLimitKey(`${ip}|/sign-in/magic-link`, 60);
    await expireRateLimitKey(`${email}|/sign-in/magic-link`, 60);

    const afterReset = await signInMagicLink({ email }, headers);
    expect(afterReset.status).not.toBe("rate_limited");
  });

  it("rejects a password reset request after it exceeds that endpoint's limit", async () => {
    const ip = uniqueTestIp();
    const headers = testRequestHeaders(ip);
    const email = uniqueEmail("password-reset-limit");
    createdRateLimitKeys.push(`${ip}|/request-password-reset`, `${email}|/request-password-reset`);

    const outcomes = [];
    for (let i = 0; i < 4; i += 1) {
      outcomes.push(await requestPasswordReset({ email }, headers));
    }

    expect(outcomes.slice(0, 3).every((outcome) => outcome.status !== "rate_limited")).toBe(true);
    expect(outcomes[3]?.status).toBe("rate_limited");
  });

  it("resets the password reset request limit once its window has elapsed", async () => {
    const ip = uniqueTestIp();
    const headers = testRequestHeaders(ip);
    const email = uniqueEmail("password-reset-window-reset");
    createdRateLimitKeys.push(`${ip}|/request-password-reset`, `${email}|/request-password-reset`);

    for (let i = 0; i < 3; i += 1) {
      await requestPasswordReset({ email }, headers);
    }
    const limited = await requestPasswordReset({ email }, headers);
    expect(limited.status).toBe("rate_limited");

    await expireRateLimitKey(`${ip}|/request-password-reset`, 60);
    await expireRateLimitKey(`${email}|/request-password-reset`, 60);

    const afterReset = await requestPasswordReset({ email }, headers);
    expect(afterReset.status).not.toBe("rate_limited");
  });

  it("returns a 429 straight from the handler when the sign-up limit is hit", async () => {
    const ip = uniqueTestIp();
    createdRateLimitKeys.push(`${ip}|/sign-up/email`);
    const email = uniqueEmail("429");
    createdEmails.push(email);
    const body = {
      name: "Rate Limited",
      email,
      password: "correct-horse-battery",
      termsAccepted: true,
      privacyAccepted: true,
    };
    const request = () =>
      getAuth().handler(
        new Request(new URL("/api/auth/sign-up/email", process.env.BETTER_AUTH_URL), {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": ip },
          body: JSON.stringify(body),
        }),
      );

    for (let i = 0; i < 3; i += 1) {
      await request();
    }
    const response = await request();
    expect(response.status).toBe(429);
  });

  it("resets the sign-up limit once its window has elapsed", async () => {
    const ip = uniqueTestIp();
    createdRateLimitKeys.push(`${ip}|/sign-up/email`);
    const request = (email: string) =>
      getAuth().handler(
        new Request(new URL("/api/auth/sign-up/email", process.env.BETTER_AUTH_URL), {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": ip },
          body: JSON.stringify({
            name: "Rate Limited",
            email,
            password: "correct-horse-battery",
            termsAccepted: true,
            privacyAccepted: true,
          }),
        }),
      );

    for (let i = 0; i < 3; i += 1) {
      const email = uniqueEmail(`sign-up-window-${String(i)}`);
      createdEmails.push(email);
      await request(email);
    }
    const limitedEmail = uniqueEmail("sign-up-window-limited");
    createdEmails.push(limitedEmail);
    const limited = await request(limitedEmail);
    expect(limited.status).toBe(429);

    await expireRateLimitKey(`${ip}|/sign-up/email`, 10);

    const resetEmail = uniqueEmail("sign-up-window-reset");
    createdEmails.push(resetEmail);
    const afterReset = await request(resetEmail);
    expect(afterReset.status).not.toBe(429);
  });
});
