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
// registerAndSignIn, and each spec's own inline flow), which goes through
// the sign-up rate limit (options.ts, RATE_LIMIT_CUSTOM_RULES: 3 per 10s per
// IP, docs/adr/0016). `throttleSignUp` (e2e/support.ts) spaces every
// sign-up in real time rather than exempting the E2E client from the limit
// it exists to test, but its spacing is process-wide module state: this
// project forces one worker and sequential specs so all of them share that
// state, instead of Playwright's default `fullyParallel`, which would run
// each spec in its own worker process (and therefore its own untracked
// sign-up clock) from the same machine/IP.
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
