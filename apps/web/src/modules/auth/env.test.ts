import { describe, expect, it } from "vitest";

import {
  isProductionDatabaseHost,
  isProductionDeployment,
  readAuthBaseUrl,
  readE2EInstrumentsRecordingsDirectory,
  readE2ESecret,
  readE2EToday,
  readOwnerEmails,
} from "./env";

describe("readAuthBaseUrl", () => {
  it("uses BETTER_AUTH_URL when set", () => {
    expect(readAuthBaseUrl({ BETTER_AUTH_URL: "https://fetha.app" })).toBe("https://fetha.app");
  });

  it("derives the base URL from VERCEL_URL when BETTER_AUTH_URL is unset", () => {
    expect(readAuthBaseUrl({ VERCEL_URL: "fetha-git-branch.vercel.app" })).toBe(
      "https://fetha-git-branch.vercel.app",
    );
  });

  it("falls back to localhost when neither is set", () => {
    expect(readAuthBaseUrl({})).toBe("http://localhost:3000");
  });
});

describe("isProductionDeployment", () => {
  it("is true only when VERCEL_ENV is production", () => {
    expect(isProductionDeployment({ VERCEL_ENV: "production" })).toBe(true);
    expect(isProductionDeployment({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isProductionDeployment({})).toBe(false);
  });
});

describe("readE2ESecret", () => {
  it("returns undefined when unset or empty", () => {
    expect(readE2ESecret({})).toBeUndefined();
    expect(readE2ESecret({ E2E_SECRET: "" })).toBeUndefined();
  });

  it("returns the configured secret", () => {
    expect(readE2ESecret({ E2E_SECRET: "shh" })).toBe("shh");
  });
});

describe("readE2EInstrumentsRecordingsDirectory", () => {
  it("returns undefined when unset or blank", () => {
    expect(readE2EInstrumentsRecordingsDirectory({})).toBeUndefined();
    expect(readE2EInstrumentsRecordingsDirectory({ E2E_B3_INSTRUMENTS_DIR: " " })).toBeUndefined();
  });

  it("returns the configured directory outside production", () => {
    expect(
      readE2EInstrumentsRecordingsDirectory({
        E2E_B3_INSTRUMENTS_DIR: "e2e/fixtures/b3-instruments",
        VERCEL_ENV: "preview",
      }),
    ).toBe("e2e/fixtures/b3-instruments");
  });

  it("is ignored in production", () => {
    expect(
      readE2EInstrumentsRecordingsDirectory({
        E2E_B3_INSTRUMENTS_DIR: "e2e/fixtures/b3-instruments",
        VERCEL_ENV: "production",
      }),
    ).toBeUndefined();
  });

  it("is ignored against the production database", () => {
    expect(
      readE2EInstrumentsRecordingsDirectory({
        E2E_B3_INSTRUMENTS_DIR: "e2e/fixtures/b3-instruments",
        DATABASE_URL: "postgres://user:pass@db.example.com/main",
        DATABASE_PRODUCTION_HOST: "db.example.com",
      }),
    ).toBeUndefined();
  });
});

describe("readE2EToday", () => {
  it("reads E2E_TODAY outside production", () => {
    expect(readE2EToday({ E2E_TODAY: "2026-09-21" })).toBe("2026-09-21");
    expect(readE2EToday({})).toBeUndefined();
    expect(readE2EToday({ E2E_TODAY: " " })).toBeUndefined();
    expect(readE2EToday({ E2E_TODAY: "21/09/2026" })).toBeUndefined();
    expect(readE2EToday({ E2E_TODAY: "2026-02-30" })).toBeUndefined();
  });

  it("is ignored in production", () => {
    expect(readE2EToday({ E2E_TODAY: "2026-09-21", VERCEL_ENV: "production" })).toBeUndefined();
  });

  it("is ignored against the production database", () => {
    expect(
      readE2EToday({
        E2E_TODAY: "2026-09-21",
        DATABASE_URL: "postgres://user:pass@db.example.com/main",
        DATABASE_PRODUCTION_HOST: "db.example.com",
      }),
    ).toBeUndefined();
  });
});

describe("isProductionDatabaseHost", () => {
  const PRODUCTION_HOST = "ep-sweet-sea-au3urksh-pooler.c-10.us-east-1.aws.neon.tech";

  it("returns false when DATABASE_URL is unset", () => {
    expect(isProductionDatabaseHost({})).toBe(false);
  });

  it("returns false when DATABASE_URL is not a valid URL", () => {
    expect(isProductionDatabaseHost({ DATABASE_URL: "not-a-url" })).toBe(false);
  });

  it("matches the hardcoded production host by default", () => {
    expect(
      isProductionDatabaseHost({ DATABASE_URL: `postgres://user:pass@${PRODUCTION_HOST}/db` }),
    ).toBe(true);
    expect(
      isProductionDatabaseHost({ DATABASE_URL: "postgres://user:pass@some-other-host/db" }),
    ).toBe(false);
  });

  it("matches the production host however it is spelled: case, trailing dot, unpooled", () => {
    for (const host of [
      PRODUCTION_HOST.toUpperCase(),
      `${PRODUCTION_HOST}.`,
      "ep-sweet-sea-au3urksh.c-10.us-east-1.aws.neon.tech",
    ]) {
      expect(isProductionDatabaseHost({ DATABASE_URL: `postgres://user:pass@${host}/db` })).toBe(
        true,
      );
    }
  });

  it("matches DATABASE_PRODUCTION_HOST instead when it is set", () => {
    const customHost = "ep-custom-host-pooler.c-99.us-east-1.aws.neon.tech";
    expect(
      isProductionDatabaseHost({
        DATABASE_URL: `postgres://user:pass@${customHost}/db`,
        DATABASE_PRODUCTION_HOST: customHost,
      }),
    ).toBe(true);
    expect(
      isProductionDatabaseHost({
        DATABASE_URL: `postgres://user:pass@${PRODUCTION_HOST}/db`,
        DATABASE_PRODUCTION_HOST: customHost,
      }),
    ).toBe(false);
  });
});

describe("readOwnerEmails", () => {
  it("returns an empty set when unset or empty", () => {
    expect(readOwnerEmails({}).size).toBe(0);
    expect(readOwnerEmails({ OWNER_EMAILS: "" }).size).toBe(0);
  });

  it("trims and lower-cases each email", () => {
    const owners = readOwnerEmails({ OWNER_EMAILS: " Owner@Example.com , other@example.com" });
    expect(owners.has("owner@example.com")).toBe(true);
    expect(owners.has("other@example.com")).toBe(true);
    expect(owners.size).toBe(2);
  });

  it("drops empty entries from stray commas", () => {
    const owners = readOwnerEmails({ OWNER_EMAILS: "owner@example.com,,  ," });
    expect([...owners]).toEqual(["owner@example.com"]);
  });
});
