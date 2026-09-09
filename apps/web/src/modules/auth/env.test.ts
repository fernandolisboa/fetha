import { describe, expect, it } from "vitest";

import { isProductionDeployment, readAuthBaseUrl, readE2ESecret } from "./env";

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
