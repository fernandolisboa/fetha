import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Vercel preview deployments sit behind Deployment Protection (Vercel SSO):
// every request needs the bypass header, or Playwright hits the SSO
// challenge page instead of the app. `x-vercel-set-bypass-cookie` makes
// Vercel also set a bypass cookie on the first response, so subsequent
// same-origin requests within the run (redirects, fetches from the page)
// stay authorized without repeating the header.
// https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection
const protectionBypass = process.env.VERCEL_PROTECTION_BYPASS;

const extraHTTPHeaders = protectionBypass
  ? {
      "x-vercel-protection-bypass": protectionBypass,
      "x-vercel-set-bypass-cookie": "true",
    }
  : undefined;

// Every spec below self-registers a brand-new account (helpers.ts,
// registerAndSignIn), which now goes through the sign-up rate limit
// (options.ts, RATE_LIMIT_CUSTOM_RULES: 3 per 10s per IP, docs/adr/0016).
// Playwright's default `fullyParallel` runs every test in its own worker,
// each from the same machine/IP, so the suite trips its own limit under
// parallel workers; this project forces one worker and sequential specs
// instead of leaving the whole config parallel.
const authSpecs = [
  "magic-link.spec.ts",
  "password-reset.spec.ts",
  "registration.spec.ts",
  "shell.spec.ts",
];

export default defineConfig({
  testDir: "./e2e",
  projects: [
    {
      name: "auth",
      testMatch: authSpecs,
      fullyParallel: false,
      workers: 1,
    },
    {
      name: "default",
      testMatch: /.*\.spec\.ts/,
      testIgnore: authSpecs,
      fullyParallel: true,
    },
  ],
  use: {
    baseURL,
    ...(extraHTTPHeaders ? { extraHTTPHeaders } : {}),
  },
});
