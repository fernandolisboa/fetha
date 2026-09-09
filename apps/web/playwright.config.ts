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

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: {
    baseURL,
    ...(protectionBypass
      ? {
          extraHTTPHeaders: {
            "x-vercel-protection-bypass": protectionBypass,
            "x-vercel-set-bypass-cookie": "true",
          },
        }
      : {}),
  },
});
