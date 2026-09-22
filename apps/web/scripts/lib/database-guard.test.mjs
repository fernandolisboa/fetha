import { describe, expect, it } from "vitest";

import {
  assertDisposableDatabase,
  assertMigrationAllowed,
  DatabaseNotAllowedError,
} from "./database-guard.mjs";

const PREVIEW_HOST = "ep-lively-mode-awapxaoj-pooler.c-12.us-east-1.aws.neon.tech";
const PRODUCTION_HOST = "ep-sweet-sea-au3urksh-pooler.c-10.us-east-1.aws.neon.tech";
const FOREIGN_HOST = "ep-someone-elses-test-db-pooler.c-3.us-east-1.aws.neon.tech";
const ACTION = "run integration tests";

describe("assertDisposableDatabase", () => {
  it("allows the default fetha-preview host with no extra configuration", () => {
    expect(() =>
      assertDisposableDatabase({ DATABASE_URL: `postgres://user:pass@${PREVIEW_HOST}/db` }, ACTION),
    ).not.toThrow();
  });

  it("allows a host that exactly matches an explicit DATABASE_RESET_ALLOWED_HOST", () => {
    expect(() =>
      assertDisposableDatabase(
        {
          DATABASE_URL: "postgres://user:pass@some-other-host.neon.tech/db",
          DATABASE_RESET_ALLOWED_HOST: "some-other-host.neon.tech",
        },
        ACTION,
      ),
    ).not.toThrow();
  });

  it("allows any non-production host when ALLOW_DISPOSABLE_DATABASE=1", () => {
    expect(() =>
      assertDisposableDatabase(
        { DATABASE_URL: "postgres://user:pass@localhost:5432/db", ALLOW_DISPOSABLE_DATABASE: "1" },
        ACTION,
      ),
    ).not.toThrow();
  });

  it("refuses a database inherited from another project, naming the action and the host", () => {
    expect(() =>
      assertDisposableDatabase({ DATABASE_URL: `postgres://user:pass@${FOREIGN_HOST}/db` }, ACTION),
    ).toThrow(`Refusing to run integration tests: host "${FOREIGN_HOST}"`);
  });

  it("refuses a host with no match and no override", () => {
    expect(() =>
      assertDisposableDatabase({ DATABASE_URL: "postgres://user:pass@localhost:5432/db" }, ACTION),
    ).toThrow(DatabaseNotAllowedError);
  });

  it("refuses the production host even with the override set", () => {
    expect(() =>
      assertDisposableDatabase(
        {
          DATABASE_URL: `postgres://user:pass@${PRODUCTION_HOST}/db`,
          ALLOW_DISPOSABLE_DATABASE: "1",
        },
        ACTION,
      ),
    ).toThrow(DatabaseNotAllowedError);
  });

  it("refuses the production host even if it were passed as DATABASE_RESET_ALLOWED_HOST", () => {
    expect(() =>
      assertDisposableDatabase(
        {
          DATABASE_URL: `postgres://user:pass@${PRODUCTION_HOST}/db`,
          DATABASE_RESET_ALLOWED_HOST: PRODUCTION_HOST,
        },
        ACTION,
      ),
    ).toThrow(DatabaseNotAllowedError);
  });

  it("refuses when DATABASE_URL is not set", () => {
    expect(() => assertDisposableDatabase({}, ACTION)).toThrow(DatabaseNotAllowedError);
  });

  it("refuses when DATABASE_URL is not a valid URL", () => {
    expect(() => assertDisposableDatabase({ DATABASE_URL: "not-a-url" }, ACTION)).toThrow(
      DatabaseNotAllowedError,
    );
  });

  it("refuses a host configured through DATABASE_PRODUCTION_HOST even with the override set", () => {
    const customProductionHost = "ep-custom-host-pooler.c-99.us-east-1.aws.neon.tech";
    expect(() =>
      assertDisposableDatabase(
        {
          DATABASE_URL: `postgres://user:pass@${customProductionHost}/db`,
          DATABASE_PRODUCTION_HOST: customProductionHost,
          ALLOW_DISPOSABLE_DATABASE: "1",
        },
        ACTION,
      ),
    ).toThrow(DatabaseNotAllowedError);
  });

  it("allows the hardcoded production host when DATABASE_PRODUCTION_HOST overrides it to something else", () => {
    expect(() =>
      assertDisposableDatabase(
        {
          DATABASE_URL: `postgres://user:pass@${PRODUCTION_HOST}/db`,
          DATABASE_PRODUCTION_HOST: "ep-some-other-host-pooler.c-1.us-east-1.aws.neon.tech",
          ALLOW_DISPOSABLE_DATABASE: "1",
        },
        ACTION,
      ),
    ).not.toThrow();
  });
});

describe("assertMigrationAllowed", () => {
  it("allows the fetha-preview host", () => {
    expect(() =>
      assertMigrationAllowed({ DATABASE_URL: `postgres://user:pass@${PREVIEW_HOST}/db` }),
    ).not.toThrow();
  });

  it("refuses a database inherited from another project", () => {
    expect(() =>
      assertMigrationAllowed({ DATABASE_URL: `postgres://user:pass@${FOREIGN_HOST}/db` }),
    ).toThrow("Refusing to migrate the database");
  });

  it("refuses the production host without the explicit production opt-in", () => {
    expect(() =>
      assertMigrationAllowed({ DATABASE_URL: `postgres://user:pass@${PRODUCTION_HOST}/db` }),
    ).toThrow(DatabaseNotAllowedError);
  });

  it("allows the production host with MIGRATE_PRODUCTION_DATABASE=1", () => {
    expect(() =>
      assertMigrationAllowed({
        DATABASE_URL: `postgres://user:pass@${PRODUCTION_HOST}/db`,
        MIGRATE_PRODUCTION_DATABASE: "1",
      }),
    ).not.toThrow();
  });

  it("refuses any other host with MIGRATE_PRODUCTION_DATABASE=1, the preview included", () => {
    for (const host of [FOREIGN_HOST, PREVIEW_HOST]) {
      expect(() =>
        assertMigrationAllowed({
          DATABASE_URL: `postgres://user:pass@${host}/db`,
          MIGRATE_PRODUCTION_DATABASE: "1",
        }),
      ).toThrow(DatabaseNotAllowedError);
    }
  });

  it("refuses when DATABASE_URL is not set, even with the production opt-in", () => {
    expect(() => assertMigrationAllowed({ MIGRATE_PRODUCTION_DATABASE: "1" })).toThrow(
      DatabaseNotAllowedError,
    );
  });
});
