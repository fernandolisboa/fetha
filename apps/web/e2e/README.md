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
- `E2E_OWNER_EMAIL`: optional, defaults to `dono-e2e@example.com`. The account on the preview's
  own `OWNER_EMAILS` allowlist (docs/adr/0042) that CI re-creates after every reset of
  `fetha-preview` (`db:seed-e2e-owner`), so nobody registers it by hand. Specs that need the
  nightly job re-run for a session (`ingestion-trigger.spec.ts`, `signals.spec.ts`,
  `decisions.spec.ts`, `scoring.spec.ts`, `backtest.spec.ts`, `compare.spec.ts`) sign this account in through a magic link and drive
  `/configuracoes`'s manual trigger form instead of holding `CRON_SECRET`; no spec needs
  `CRON_SECRET` anymore, since the manual trigger moved off it (#51).
- `VERCEL_PROTECTION_BYPASS`: Vercel Deployment Protection (SSO) sits in front of every preview
  deployment, so every Playwright request needs the bypass header or it hits the SSO challenge
  page instead of the app. When set, `playwright.config.ts` sends
  `x-vercel-protection-bypass: <value>` and `x-vercel-set-bypass-cookie: true` as
  `extraHTTPHeaders` on every request; unset (e.g. a local run against `pnpm dev`), no bypass
  headers are sent. Generate the value under the project's Vercel dashboard → Settings →
  Deployment Protection → Protection Bypass for Automation.

`registration.spec.ts` registers a fresh account, reads the verification link back through the
E2E-only route `/api/e2e/verification-link`, opens it and sets the password there (the link
signs its opener in, docs/adr/0016), signs out and back in with that password, confirms the signed-in home page
shows the account's email (proof the session cookie reached the browser), signs out and confirms
the signed-out state.

`magic-link.spec.ts` registers and verifies a fresh account, then signs in through a magic link
read back the same way, and separately proves a reused or already-consumed link redirects to the
error screen instead of granting a session.

`password-reset.spec.ts` registers and verifies a fresh account, requests a password reset, reads
the reset link back through the same E2E-only route, sets a new password, and confirms the old
password no longer works while the new one signs in.

`signals.spec.ts` declares a risk profile, creates and activates a stock-only "always fires"
strategy, triggers the owner's manual ingestion trigger for a fixed session through
`triggerIngestionAsOwner` (#51), and confirms the resulting signal shows up in the `/sinais`
inbox. It signs in the CI-seeded owner account (`E2E_OWNER_EMAIL`) and assumes PETR4 is already
ingested for session `2026-09-09` in the preview database.

`decisions.spec.ts` extends that same flow one step further: on the resulting signal's row it
opens the DecisionBar dialog, records "Não entrar" with a rationale, confirms the row now shows the
recorded decision instead of the dialog trigger, then opens `/diario` and confirms the journal
entry with the same kind and rationale. Needs the same `E2E_SECRET` and owner account as
`signals.spec.ts`.

`scoring.spec.ts` seeds a thesis-only decision through the E2E-only route
`/api/e2e/seed-decision` (404 in production or when `E2E_SECRET` is unset, same shape as
`/api/e2e/verification-link`; the write itself goes through `seedE2EDecision`,
`@/modules/decisions` — the route imports no `@/modules/*/schema` and writes no table directly),
backdated to `decided_at` on the already-ingested session `2026-09-08` with `horizon` the _next_
ingested session `2026-09-09` (no look-ahead, #29 fix-web item 3), then triggers the owner's
manual ingestion trigger and confirms `/diario` shows the decision already scored — "Tese
confirmada" and a Brier score, not "sem pontuação ainda" — proving the scoring job (#29) ran in
the same run. Needs the same `E2E_SECRET` and owner account as `signals.spec.ts`, and the
same PETR4/`2026-09-08`+`2026-09-09` ingestion precondition.

`portfolio.spec.ts` covers the real portfolio (#26): it imports the synthetic B3 "Negociação"
fixture (`src/modules/portfolio/b3-import/fixtures/negociacao.xlsx`) through the import dialog and
checks the result line and the PETR4 position, then records a fill in a real expired PETR4 series,
groups it into an operation, confirms the proposed settlement and checks the operation is
"vencida". The series comes from the E2E-only route `/api/e2e/expired-series` (404 in production
or when `E2E_SECRET` is unset, same guard as `/api/e2e/verification-link`), which reads shared
reference data only: the latest expired PETR4 series that traded before expiry and whose expiry
close is ingested. Needs `E2E_SECRET` and ingested PETR4 option data in the preview database.

`pwa-cache.spec.ts` covers the service worker's cache policy (#43, ADR-0025): it registers and
signs in, waits until the worker controls the page, opens `/carteira` and fetches the session,
then asserts Cache Storage holds no `/api/*` response, RSC payload or page, before and after
signing out, and that the precached `offline.html` is the "Sem conexão" page. That test needs
`E2E_SECRET`. A second test needs no secret: once the worker controls the page it switches the
browser offline and checks that a navigation renders the "Sem conexão" page.

`account.spec.ts` covers the LGPD flows (#31, ADR-0027): it registers and signs in, downloads
"Exportar meus dados" from Configurações, checks the file is a `fetha-export/1` document holding
the new user, and checks the export shows up in the access log. A second test deletes a fresh
account from Configurações (a wrong password first, then the right one), lands on
`/conta-excluida` and checks the same credentials no longer sign in. Needs `E2E_SECRET`.
