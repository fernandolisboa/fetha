import { describe, expect, it } from "vitest";

import { assertDatabaseResetAllowed, DatabaseResetNotAllowedError } from "./reset-guard.mjs";

describe("assertDatabaseResetAllowed", () => {
  it("allows a host that carries the fetha-preview marker", () => {
    expect(() =>
      assertDatabaseResetAllowed({
        DATABASE_URL: "postgres://user:pass@ep-fetha-preview-abc123.aws.neon.tech/db",
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

  it("refuses a host with no preview marker and no override", () => {
    expect(() =>
      assertDatabaseResetAllowed({ DATABASE_URL: "postgres://user:pass@localhost:5432/db" }),
    ).toThrow(DatabaseResetNotAllowedError);
  });

  it("refuses a host matching the production marker even with the override set", () => {
    expect(() =>
      assertDatabaseResetAllowed({
        DATABASE_URL: "postgres://user:pass@ep-fetha-production-abc123.aws.neon.tech/db",
        ALLOW_DATABASE_RESET: "1",
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
});
