# Playwright e2e

## CI

`.github/workflows/ci.yml`'s `preview-database` job runs the whole suite in the runner itself,
against a production build (`next build` + `next start` on `localhost:3000`) backed by the same
Postgres-service-container-behind-Neon's-local-proxy setup the `integration` job uses
(`db.localtest.me`, pinned to loopback; `ALLOW_DISPOSABLE_DATABASE=1`), not a Vercel preview
(docs/adr/0016's 2026-10-16 addendum). It migrates and seeds that disposable database itself, then
builds, starts the app with a fixed, non-secret `E2E_SECRET` and `REGISTRATION_MODE=open`, and runs
`pnpm --filter @fetha/web test:e2e` against it. It runs on `pull_request` only; a push to `main` has
no e2e step.

The shared `fetha-preview` project is no longer touched by this job: its own
reset/migrate/seed-structures/seed-e2e-owner maintenance, for manual checks against Vercel
previews, lives in the separate `preview-database-maintenance` job, whose database steps are
`continue-on-error: true` so a Neon quota outage there never fails the check this job's own name
gates merges on.

When a spec fails in CI, the run uploads a `playwright-report` artifact with the HTML report, the
failing tests' traces (`test-results/`) and the server log (`next-start.log`).

## Setup project

Every project depends on `setup` (`owner.setup.ts`), which runs first and does two things:

- It signs the owner in through one magic link and saves that session to `e2e/.auth/owner.json`
  (git-ignored). Specs that re-run the nightly job (`signals.spec.ts`, `decisions.spec.ts`,
  `scoring.spec.ts`, `ingestion-trigger.spec.ts`) open a context from that file instead of signing
  in again, so the owner sends one magic link per run, well under the per-account limit of 3 per
  60 s.
- It drives the owner's manual trigger for the fixed sessions the suite reads (`e2e/sessions.ts`):
  `2026-09-08` and `2026-09-09` (backtest and comparison window, scoring fixture) and `2026-09-18`
  (the monthly expiry that gives `portfolio.spec.ts` an expired PETR4 series). No spec relies on
  another one having ingested first. Signals and decisions ingest their own session: the second
  newest closed B3 session, which the E2E-only route `/api/e2e/recent-session` reads from the
  ingested calendar (the inbox only takes entries from its newest few sessions, so a fixed date
  would age out).
- The instruments registry is not fetched from B3 in CI. `arquivos.b3.com.br` times out from
  GitHub's runners (504 on the token request), so the job sets `E2E_B3_INSTRUMENTS_DIR` to
  `e2e/fixtures/b3-instruments` and the nightly job replays those recordings instead: one
  `<session>.csv` per fixed session, B3's own `InstrumentsConsolidatedFile` for that date cut down
  to its PETR4 option rows and the columns the parser reads. A session with no recording (the
  recent session signals and decisions ingest) replays the newest one before it, so that session's
  PETR4 chain and IV index only see the strikes listed by then; no spec asserts either. The
  variable is ignored in production and against the production database. COTAHIST still comes live from `bvmf.bmfbovespa.com.br`. To record a new
  session, download that date's file through the two-step flow in
  `src/modules/market-data/adapters/b3-instruments/fetch.ts` and keep the same rows and columns.
  Series listed after the newest recording never reach the e2e database, so the PETR4 chain only
  shrinks as its near-month expiries roll off. `operation-builder.spec.ts` (collar on traded
  series) and `shell.spec.ts` (palette to a series page) need unexpired series with recent trades:
  record a newer session once the newest recording's near-month expiries have passed.
- Each run must end with `calendar`, `cotahist` and `instruments` ok or skipped. The `sgs` and
  `iv_index` sources feed no spec and are not asserted, so a Bacen outage (#289) does not fail the
  suite.

The whole suite runs from one IP, and every auth endpoint keeps its real rate limits. Sign-ups are
spaced by `throttleSignUp` and retried after the window (`e2e/support.ts`); a magic-link send or
open that is answered with a rate limit waits the window out and retries (`requestMagicLink`,
`openMagicLink`).

## Manual run

Run by hand against a Vercel preview deployment that has `E2E_SECRET` set and
`REGISTRATION_MODE=open` (or a matching invite seeded with `scripts/seed-invite.mjs`):

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
  `fetha-preview` (`db:seed-e2e-owner`), so nobody registers it by hand. The setup project signs
  this account in through a magic link, and every run of the nightly job drives
  `/configuracoes/administracao`'s manual trigger form with that session instead of holding `CRON_SECRET`; no
  spec needs `CRON_SECRET` anymore, since the manual trigger moved off it (#51).
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
strategy, triggers the owner's manual ingestion trigger for the second newest closed session
through `triggerIngestionAsOwner` (#51), and confirms the resulting signal shows up in the
`/sinais` inbox. It uses the owner session the setup project saved.

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
the same run. Needs the same `E2E_SECRET` and owner session as `signals.spec.ts`; the setup project
ingests both sessions.

`portfolio.spec.ts` covers the real portfolio (#26): it imports the synthetic B3 "Negociação"
fixture (`src/modules/portfolio/b3-import/fixtures/negociacao.xlsx`) through the import dialog and
checks the result line and the PETR4 position, then records a fill in a real expired PETR4 series,
groups it into an operation, confirms the proposed settlement and checks the operation is
"vencida". The series comes from the E2E-only route `/api/e2e/expired-series` (404 in production
or when `E2E_SECRET` is unset, same guard as `/api/e2e/verification-link`), which reads shared
reference data only: the latest expired PETR4 series that traded before expiry and whose expiry
close is ingested; the setup project ingests `2026-09-18` for that. Needs `E2E_SECRET`.

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

`tour.spec.ts` covers the guided tour (#231, ADR-0046): it registers a fresh account, sees the
tour start on the watchlist, steps forward and back, skips it, reloads and checks it stays
dismissed, then replays it from `/como-usar` and walks all eight steps to "Concluir". A second
test skips it with Escape. It is the one spec that imports Playwright's own `test`; every other
spec imports `test` from `e2e/tour.ts`, whose page fixture skips the tour when it shows. Needs
`E2E_SECRET`.
