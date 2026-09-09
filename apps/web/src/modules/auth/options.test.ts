import { describe, expect, it, vi } from "vitest";

vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: vi.fn(() => "fake-drizzle-adapter"),
}));

import { drizzleAdapter } from "better-auth/adapters/drizzle";

import type { Database } from "@/db/client";

import { FakeMailer } from "./email/fake-mailer";
import { buildAuthOptions, buildUserCreateOverrides } from "./options";
import { CURRENT_TERMS_VERSION } from "./terms";

describe("buildUserCreateOverrides", () => {
  it("stamps the current terms version and acceptance timestamp on every user creation", () => {
    const acceptedAt = new Date("2026-09-09T12:00:00.000Z");
    const overrides = buildUserCreateOverrides({ email: "New.User@Example.com" }, acceptedAt);

    expect(overrides).toEqual({
      termsVersion: CURRENT_TERMS_VERSION,
      termsAcceptedAt: acceptedAt,
      email: "new.user@example.com",
    });
  });

  it("never omits termsVersion, so the merged create data can never produce a null column", () => {
    const overrides = buildUserCreateOverrides({ email: "a@example.com" });
    expect(overrides.termsVersion).toBe(CURRENT_TERMS_VERSION);
    expect(overrides.termsAcceptedAt).toBeInstanceOf(Date);
  });
});

describe("buildAuthOptions", () => {
  it("enables the Drizzle adapter's transaction option, so user + account creation is atomic", () => {
    const fakeDb = {} as Database;
    const fakeEnv = { BETTER_AUTH_SECRET: "test-secret", BETTER_AUTH_URL: "http://localhost:3000" };

    buildAuthOptions(fakeDb, fakeEnv, new FakeMailer());

    expect(drizzleAdapter).toHaveBeenCalledWith(fakeDb, { provider: "pg", transaction: true });
  });

  it("disables the database-backed rate limiter under plain Vitest, but not under the integration config", () => {
    const fakeDb = {} as Database;
    const base = { BETTER_AUTH_SECRET: "test-secret", BETTER_AUTH_URL: "http://localhost:3000" };

    const unitTestOptions = buildAuthOptions(fakeDb, { ...base, VITEST: "true" }, new FakeMailer());
    expect(unitTestOptions.rateLimit.enabled).toBe(false);

    const integrationTestOptions = buildAuthOptions(
      fakeDb,
      { ...base, VITEST: "true", VITEST_INTEGRATION: "1" },
      new FakeMailer(),
    );
    expect(integrationTestOptions.rateLimit.enabled).toBe(true);

    const runtimeOptions = buildAuthOptions(fakeDb, base, new FakeMailer());
    expect(runtimeOptions.rateLimit.enabled).toBe(true);
  });

  it("stores rate limit counters in the database, keyed per auth endpoint", () => {
    const fakeDb = {} as Database;
    const fakeEnv = { BETTER_AUTH_SECRET: "test-secret", BETTER_AUTH_URL: "http://localhost:3000" };

    const options = buildAuthOptions(fakeDb, fakeEnv, new FakeMailer());

    expect(options.rateLimit.storage).toBe("database");
    expect(options.rateLimit.customRules?.["/sign-in/email"]).toEqual({ window: 10, max: 3 });
    expect(options.rateLimit.customRules?.["/sign-up/email"]).toEqual({ window: 10, max: 3 });
    expect(options.rateLimit.customRules?.["/request-password-reset"]).toEqual({
      window: 60,
      max: 3,
    });
    expect(options.rateLimit.customRules?.["/reset-password"]).toEqual({ window: 60, max: 5 });
    expect(options.rateLimit.customRules?.["/send-verification-email"]).toEqual({
      window: 60,
      max: 3,
    });
  });

  it("registers the magic-link plugin", () => {
    const fakeDb = {} as Database;
    const fakeEnv = { BETTER_AUTH_SECRET: "test-secret", BETTER_AUTH_URL: "http://localhost:3000" };

    const options = buildAuthOptions(fakeDb, fakeEnv, new FakeMailer());
    const magicLinkPlugin = options.plugins.find((plugin) => plugin.id === "magic-link");

    expect(magicLinkPlugin).toBeDefined();
  });
});
