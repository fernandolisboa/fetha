import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readLocalEnvFile, withLocalEnvFile } from "./local-env.mjs";

let dir;

function envFile(contents) {
  dir = mkdtempSync(path.join(tmpdir(), "fetha-local-env-"));
  const file = path.join(dir, ".env.local");
  writeFileSync(file, contents);
  return file;
}

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

describe("withLocalEnvFile", () => {
  it("lets the repository's .env.local win over a DATABASE_URL inherited from the shell", () => {
    const file = envFile('DATABASE_URL="postgres://u:p@preview-host/db"\n');

    const env = withLocalEnvFile(
      { DATABASE_URL: "postgres://u:p@foreign-host/db", KEEP: "1" },
      file,
    );

    expect(env.DATABASE_URL).toBe("postgres://u:p@preview-host/db");
    expect(env.KEEP).toBe("1");
  });

  it("keeps the inherited environment untouched when there is no .env.local", () => {
    const missing = path.join(tmpdir(), "fetha-no-such-dir", ".env.local");

    expect(withLocalEnvFile({ DATABASE_URL: "postgres://u:p@ci-host/db" }, missing)).toEqual({
      DATABASE_URL: "postgres://u:p@ci-host/db",
    });
    expect(readLocalEnvFile(missing)).toEqual({});
  });
});
