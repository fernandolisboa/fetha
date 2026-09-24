import { describe, expect, it } from "vitest";

import {
  isProductionDatabaseHost,
  isProductionDeployment,
  readAuthBaseUrl,
  readE2ESecret,
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
