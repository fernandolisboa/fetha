import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { resolveDevDatabaseUrl } from "./dev-database.mjs";

let dir;

function appDir(files) {
  dir = mkdtempSync(path.join(tmpdir(), "fetha-dev-db-"));
  for (const [name, url] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), `DATABASE_URL=${url}\n`);
  }
  return pathToFileURL(`${dir}/`);
}

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveDevDatabaseUrl", () => {
  it("lets .env.local win over a DATABASE_URL inherited from the shell", () => {
    const app = appDir({ ".env.local": "postgres://u:p@preview/db" });

    expect(resolveDevDatabaseUrl({ DATABASE_URL: "postgres://u:p@foreign/db" }, app)).toEqual({
      source: "apps/web/.env.local",
      url: "postgres://u:p@preview/db",
    });
  });

  it("uses the shell's DATABASE_URL over the files Next.js would load after it", () => {
    const app = appDir({ ".env.development.local": "postgres://u:p@file/db" });

    expect(resolveDevDatabaseUrl({ DATABASE_URL: "postgres://u:p@shell/db" }, app)).toEqual({
      source: "the environment",
      url: "postgres://u:p@shell/db",
    });
  });

  it("finds a DATABASE_URL that only Next.js's other env files define", () => {
    const app = appDir({ ".env": "postgres://u:p@dotenv/db" });

    expect(resolveDevDatabaseUrl({}, app)).toEqual({
      source: "apps/web/.env",
      url: "postgres://u:p@dotenv/db",
    });
  });

  it("returns nothing when no DATABASE_URL is set anywhere", () => {
    expect(resolveDevDatabaseUrl({}, appDir({}))).toBeUndefined();
  });
});
