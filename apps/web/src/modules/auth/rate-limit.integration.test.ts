import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import { rateLimit } from "@/db/schema/rate-limits";
import { deleteTestUser } from "@/db/test/cleanup";

import { getAuth } from "./auth";
import { signIn, signInMagicLink } from "./service";
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

async function attemptSignIn(headers: Headers) {
  return signIn({ email: "no-such-user@example.com", password: "wrong-password" }, headers);
}

describe("database-backed rate limiting on auth endpoints", () => {
  it("rejects a client after it exceeds the sign-in limit, from a single shared IP", async () => {
    const ip = uniqueTestIp();
    const headers = testRequestHeaders(ip);
    createdRateLimitKeys.push(`${ip}|/sign-in/email`);

    // The configured rule (options.ts, RATE_LIMIT_CUSTOM_RULES) is
    // window: 10, max: 3.
    const outcomes = [];
    for (let i = 0; i < 4; i += 1) {
      outcomes.push(await attemptSignIn(headers));
    }

    expect(outcomes.slice(0, 3).every((outcome) => outcome.status !== "rate_limited")).toBe(true);
    expect(outcomes[3]?.status).toBe("rate_limited");
  });

  it("does not rate-limit a different client on the same endpoint", async () => {
    const ip = uniqueTestIp();
    const headers = testRequestHeaders(ip);
    createdRateLimitKeys.push(`${ip}|/sign-in/email`);

    for (let i = 0; i < 3; i += 1) {
      await attemptSignIn(headers);
    }

    const otherIp = uniqueTestIp();
    const otherHeaders = testRequestHeaders(otherIp);
    createdRateLimitKeys.push(`${otherIp}|/sign-in/email`);

    const outcome = await attemptSignIn(otherHeaders);
    expect(outcome.status).not.toBe("rate_limited");
  });

  it("resets the limit once the window has elapsed", async () => {
    const ip = uniqueTestIp();
    const headers = testRequestHeaders(ip);
    createdRateLimitKeys.push(`${ip}|/sign-in/email`);

    for (let i = 0; i < 3; i += 1) {
      await attemptSignIn(headers);
    }
    const limited = await attemptSignIn(headers);
    expect(limited.status).toBe("rate_limited");

    await new Promise((resolve) => setTimeout(resolve, 10_500));

    const afterReset = await attemptSignIn(headers);
    expect(afterReset.status).not.toBe("rate_limited");
  }, 20000);

  it("keeps sign-in and magic-link counters independent for the same IP", async () => {
    const ip = uniqueTestIp();
    const headers = testRequestHeaders(ip);
    createdRateLimitKeys.push(`${ip}|/sign-in/email`, `${ip}|/sign-in/magic-link`);

    for (let i = 0; i < 3; i += 1) {
      await attemptSignIn(headers);
    }
    const limited = await attemptSignIn(headers);
    expect(limited.status).toBe("rate_limited");

    const magicLinkOutcome = await signInMagicLink({ email: "someone@example.com" }, headers);
    expect(magicLinkOutcome.status).not.toBe("rate_limited");
  });

  it("rejects a magic-link client after it exceeds that endpoint's own limit", async () => {
    const ip = uniqueTestIp();
    const headers = testRequestHeaders(ip);
    createdRateLimitKeys.push(`${ip}|/sign-in/magic-link`);

    // The magic-link plugin's own rule (options.ts) is window: 60, max: 3.
    const outcomes = [];
    for (let i = 0; i < 4; i += 1) {
      outcomes.push(await signInMagicLink({ email: "someone@example.com" }, headers));
    }

    expect(outcomes.slice(0, 3).every((outcome) => outcome.status !== "rate_limited")).toBe(true);
    expect(outcomes[3]?.status).toBe("rate_limited");
  });

  it("returns a 429 straight from the handler when the limit is hit", async () => {
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
});
