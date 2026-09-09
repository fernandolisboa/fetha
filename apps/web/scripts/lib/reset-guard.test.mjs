import { describe, expect, it } from "vitest";

import { assertDatabaseResetAllowed, DatabaseResetNotAllowedError } from "./reset-guard.mjs";

const PREVIEW_HOST = "ep-lively-mode-awapxaoj-pooler.c-12.us-east-1.aws.neon.tech";
const PRODUCTION_HOST = "ep-sweet-sea-au3urksh-pooler.c-10.us-east-1.aws.neon.tech";

describe("assertDatabaseResetAllowed", () => {
  it("allows the default fetha-preview host with no extra configuration", () => {
    expect(() =>
      assertDatabaseResetAllowed({ DATABASE_URL: `postgres://user:pass@${PREVIEW_HOST}/db` }),
    ).not.toThrow();
  });

  it("allows a host that exactly matches an explicit DATABASE_RESET_ALLOWED_HOST", () => {
    expect(() =>
      assertDatabaseResetAllowed({
        DATABASE_URL: "postgres://user:pass@some-other-host.neon.tech/db",
        DATABASE_RESET_ALLOWED_HOST: "some-other-host.neon.tech",
      }),
    ).not.toThrow();
  });

  it("allows any host when ALLOW_DATABASE_RESET=1", () => {
    expect(() =>
      assertDatabaseResetAllowed({
        DATABASE_URL: "postgres://user:pass@localhost:5432/db",
        ALLOW_DATABASE_RESET: "1",
      }),
    ).not.toThrow();
  });

  it("refuses a host with no match and no override", () => {
    expect(() =>
      assertDatabaseResetAllowed({ DATABASE_URL: "postgres://user:pass@localhost:5432/db" }),
    ).toThrow(DatabaseResetNotAllowedError);
  });

  it("refuses the production host even with the override set", () => {
    expect(() =>
      assertDatabaseResetAllowed({
        DATABASE_URL: `postgres://user:pass@${PRODUCTION_HOST}/db`,
        ALLOW_DATABASE_RESET: "1",
      }),
    ).toThrow(DatabaseResetNotAllowedError);
  });

  it("refuses the production host even if it were passed as DATABASE_RESET_ALLOWED_HOST", () => {
    expect(() =>
      assertDatabaseResetAllowed({
        DATABASE_URL: `postgres://user:pass@${PRODUCTION_HOST}/db`,
        DATABASE_RESET_ALLOWED_HOST: PRODUCTION_HOST,
      }),
    ).toThrow(DatabaseResetNotAllowedError);
  });

  it("refuses when DATABASE_URL is not set", () => {
    expect(() => assertDatabaseResetAllowed({})).toThrow(DatabaseResetNotAllowedError);
  });

  it("refuses when DATABASE_URL is not a valid URL", () => {
    expect(() => assertDatabaseResetAllowed({ DATABASE_URL: "not-a-url" })).toThrow(
      DatabaseResetNotAllowedError,
    );
  });

  it("refuses a host configured through DATABASE_PRODUCTION_HOST even with the override set", () => {
    const customProductionHost = "ep-custom-host-pooler.c-99.us-east-1.aws.neon.tech";
    expect(() =>
      assertDatabaseResetAllowed({
        DATABASE_URL: `postgres://user:pass@${customProductionHost}/db`,
        DATABASE_PRODUCTION_HOST: customProductionHost,
        ALLOW_DATABASE_RESET: "1",
      }),
    ).toThrow(DatabaseResetNotAllowedError);
  });

  it("allows the hardcoded production host when DATABASE_PRODUCTION_HOST overrides it to something else", () => {
    expect(() =>
      assertDatabaseResetAllowed({
        DATABASE_URL: `postgres://user:pass@${PRODUCTION_HOST}/db`,
        DATABASE_PRODUCTION_HOST: "ep-some-other-host-pooler.c-1.us-east-1.aws.neon.tech",
        ALLOW_DATABASE_RESET: "1",
      }),
    ).not.toThrow();
  });
});
