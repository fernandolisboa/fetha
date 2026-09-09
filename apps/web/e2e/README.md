# Playwright e2e

Not wired into CI yet (no preview-URL plumbing exists). Run by hand against a Vercel preview
deployment that has `E2E_SECRET` set and `REGISTRATION_MODE=open` (or a matching invite seeded
with `scripts/seed-invite.mjs`):

```
E2E_SECRET=<value from Vercel> \
PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app \
pnpm --filter @fetha/web exec playwright install --with-deps chromium
pnpm --filter @fetha/web test:e2e
```

`registration.spec.ts` registers a fresh account, reads the verification link back through the
E2E-only route `/api/e2e/verification-link` (404 in production or when `E2E_SECRET` is unset),
verifies, and signs in.
