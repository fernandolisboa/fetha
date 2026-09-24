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

`magic-link.spec.ts` registers and verifies a fresh account, then signs in through a magic link
read back the same way, and separately proves a reused or already-consumed link redirects to the
error screen instead of granting a session.

`password-reset.spec.ts` registers and verifies a fresh account, requests a password reset, reads
the reset link back through the same E2E-only route, sets a new password, and confirms the old
password no longer works while the new one signs in.

`signals.spec.ts` declares a risk profile, creates and activates a stock-only "always fires"
strategy, triggers the nightly cron's manual POST trigger for a fixed session, and confirms the
resulting signal shows up in the `/sinais` inbox. It also needs `CRON_SECRET` (the same bearer
secret `api/cron/ingest` checks) alongside `E2E_SECRET`, and assumes PETR4 is already ingested for
session `2026-09-09` in the preview database.

`decisions.spec.ts` extends that same flow one step further: on the resulting signal's row it
opens the DecisionBar dialog, records "Não entrar" with a rationale, confirms the row now shows the
recorded decision instead of the dialog trigger, then opens `/diario` and confirms the journal
entry with the same kind and rationale. Needs the same `E2E_SECRET`/`CRON_SECRET` pair as
`signals.spec.ts`.
