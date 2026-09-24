import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertDisposableDatabase,
  assertWritableDatabase,
  guardedDatabaseEnv,
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

  it("refuses the production host with the override however it is spelled: case, trailing dot, unpooled", () => {
    for (const host of [
      PRODUCTION_HOST.toUpperCase(),
      `${PRODUCTION_HOST}.`,
      "ep-sweet-sea-au3urksh.c-10.us-east-1.aws.neon.tech",
    ]) {
      expect(() =>
        assertDisposableDatabase(
          { DATABASE_URL: `postgres://user:pass@${host}/db`, ALLOW_DISPOSABLE_DATABASE: "1" },
          ACTION,
        ),
      ).toThrow(`host "${host}" is the production database`);
    }
  });

  it("allows the fetha-preview endpoint through its unpooled host too", () => {
    expect(() =>
      assertDisposableDatabase(
        { DATABASE_URL: `postgres://user:pass@${PREVIEW_HOST.replace("-pooler", "")}/db` },
        ACTION,
      ),
    ).not.toThrow();
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

describe("assertWritableDatabase", () => {
  it("allows the fetha-preview host", () => {
    expect(() =>
      assertWritableDatabase(
        { DATABASE_URL: `postgres://user:pass@${PREVIEW_HOST}/db` },
        "migrate the database",
      ),
    ).not.toThrow();
  });

  it("refuses a database inherited from another project", () => {
    expect(() =>
      assertWritableDatabase(
        { DATABASE_URL: `postgres://user:pass@${FOREIGN_HOST}/db` },
        "migrate the database",
      ),
    ).toThrow("Refusing to migrate the database");
  });

  it("refuses the production host without the explicit production opt-in", () => {
    expect(() =>
      assertWritableDatabase(
        { DATABASE_URL: `postgres://user:pass@${PRODUCTION_HOST}/db` },
        "migrate the database",
      ),
    ).toThrow(DatabaseNotAllowedError);
  });

  it("allows the production host with ALLOW_PRODUCTION_DATABASE=1", () => {
    expect(() =>
      assertWritableDatabase(
        {
          DATABASE_URL: `postgres://user:pass@${PRODUCTION_HOST}/db`,
          ALLOW_PRODUCTION_DATABASE: "1",
        },
        "migrate the database",
      ),
    ).not.toThrow();
  });

  it("refuses any other host with ALLOW_PRODUCTION_DATABASE=1, the preview included", () => {
    for (const host of [FOREIGN_HOST, PREVIEW_HOST]) {
      expect(() =>
        assertWritableDatabase(
          {
            DATABASE_URL: `postgres://user:pass@${host}/db`,
            ALLOW_PRODUCTION_DATABASE: "1",
          },
          "migrate the database",
        ),
      ).toThrow(DatabaseNotAllowedError);
    }
  });

  it("refuses when DATABASE_URL is not set, even with the production opt-in", () => {
    expect(() =>
      assertWritableDatabase({ ALLOW_PRODUCTION_DATABASE: "1" }, "migrate the database"),
    ).toThrow(DatabaseNotAllowedError);
  });
});

describe("guardedDatabaseEnv", () => {
  let dir;

  function envFile(contents) {
    dir = mkdtempSync(path.join(tmpdir(), "fetha-guard-"));
    const file = path.join(dir, ".env.local");
    writeFileSync(file, contents);
    return file;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("prints the refusal as one line and exits 1 instead of throwing", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exited");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const missing = path.join(tmpdir(), "fetha-no-such-dir", ".env.local");

    expect(() =>
      guardedDatabaseEnv(
        assertDisposableDatabase,
        ACTION,
        { DATABASE_URL: `postgres://user:pass@${FOREIGN_HOST}/db` },
        missing,
      ),
    ).toThrow("exited");
    expect(exit).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/^Refusing to run integration tests/));
  });

  it("names the host it will use and says when .env.local overrode the environment", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const file = envFile(`DATABASE_URL=postgres://user:pass@${PREVIEW_HOST}/db\n`);

    const env = guardedDatabaseEnv(
      assertDisposableDatabase,
      ACTION,
      { DATABASE_URL: "postgres://user:pass@localhost:5432/scratch" },
      file,
    );

    expect(env.DATABASE_URL).toBe(`postgres://user:pass@${PREVIEW_HOST}/db`);
    expect(error).toHaveBeenCalledWith(
      `About to run integration tests on host "${PREVIEW_HOST}" from apps/web/.env.local, ` +
        "overriding the DATABASE_URL set in the environment.",
    );
  });
});
