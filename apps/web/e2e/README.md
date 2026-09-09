# Playwright e2e

Not wired into CI yet (no preview-URL plumbing exists). Run by hand against a Vercel preview
deployment that has `E2E_SECRET` set and `REGISTRATION_MODE=open` (or a matching invite seeded
with `scripts/seed-invite.mjs`):

```
E2E_SECRET=<value from Vercel> \
PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app \
VERCEL_PROTECTION_BYPASS=<value from Vercel> \
pnpm --filter @fetha/web exec playwright install --with-deps chromium
pnpm --filter @fetha/web test:e2e
```

Environment variables:

- `PLAYWRIGHT_BASE_URL`: the Vercel preview URL under test (`https://<preview>.vercel.app`).
  Defaults to `http://localhost:3000` for a local run against `pnpm dev`.
- `E2E_SECRET`: shared secret for the E2E-only route `/api/e2e/verification-link` (404 in
  production or when unset). Set on the Vercel project as `E2E_SECRET`; the spec skips entirely
  when this is not set.
- `VERCEL_PROTECTION_BYPASS`: Vercel Deployment Protection (SSO) sits in front of every preview
  deployment, so every Playwright request needs the bypass header or it hits the SSO challenge
  page instead of the app. When set, `playwright.config.ts` sends
  `x-vercel-protection-bypass: <value>` and `x-vercel-set-bypass-cookie: true` as
  `extraHTTPHeaders` on every request; unset (e.g. a local run against `pnpm dev`), no bypass
  headers are sent. Generate the value under the project's Vercel dashboard → Settings →
  Deployment Protection → Protection Bypass for Automation.

`registration.spec.ts` registers a fresh account, reads the verification link back through the
E2E-only route `/api/e2e/verification-link`, verifies, signs in, confirms the signed-in home page
shows the account's email (proof the session cookie reached the browser), signs out and confirms
the signed-out state.
