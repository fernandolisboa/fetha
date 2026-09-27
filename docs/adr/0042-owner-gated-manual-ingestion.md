---
status: accepted
date: 2026-09-27
---

# The manual ingestion trigger is gated by the owner's session, not `CRON_SECRET` (#51)

## Context

`api/cron/ingest` answered both `GET` (Vercel Cron) and `POST` (the owner's manual re-run of a
session, #12) behind the same bearer check against `CRON_SECRET`. That secret is meant to stay
server-only, known only to Vercel Cron's own configuration; the manual trigger forced a human (the
owner, running Playwright by hand or curling the endpoint) to hold and paste it, the same failure
mode `E2E_SECRET`'s own guard rails exist to avoid for the E2E-only routes. `CRON_SECRET` also
carried no notion of _who_ triggered a run, only _that_ the caller knew the secret.

## Decision

1. **`OWNER_EMAILS`, a new env var, names the account(s) allowed to trigger ingestion by hand.**
   Comma-separated, trimmed and lower-cased the same way the Vercel Global Config's
   `registration_mode` value is (ADR-0020): unset or empty means nobody is the owner, never
   everybody. `apps/web/src/modules/auth/env.ts`'s `readOwnerEmails` parses it, following the
   existing `readE2ESecret`/`isProductionDeployment` shape (a plain function over an injectable env
   record, not a Zod-validated schema — this repo validates provider payloads, strategy files and
   AI output at the edges with Zod, but reads its own server env the same untyped way
   `CRON_SECRET`, `E2E_SECRET` and `BETTER_AUTH_URL` already do).

2. **`isOwner()`, the auth module's own public entry, decides.** It reads the session from the
   server's own request headers (`getAuth().api.getSession`), never an id or email a client
   supplies, and requires the account's email to be verified before checking it against
   `OWNER_EMAILS`. The allowlist check and the verified-email requirement live in a pure
   `isOwnerEmail(candidate, env)`, unit-testable without a session; `isOwner()` is the thin
   session-reading wrapper around it.

3. **The nightly job's body moves out of the route, `apps/web/src/modules/nightly`.**
   `runNightlyJob(db, { session? })` holds the purge → ingest → evaluate → score sequence and the
   response shape `api/cron/ingest`'s `GET` used to build inline; both the cron route and the new
   Server Action call it, so their behavior can never drift apart. The module is its own boundary
   (not folded into `market-data`) because it orchestrates auth's purges, market-data's ingest,
   strategies' evaluation and decisions' scoring — no single existing module owns that
   cross-cutting sequence.

4. **The manual trigger is a session-authenticated Server Action, `triggerNightlyJobAction`.**
   It re-checks `isOwner()` itself on every call — the owner-only section of `/configuracoes` that
   renders its form is never trusted on its own, the same way every other Server Action in this
   repo re-derives the caller from the session rather than trusting what the client sent. A
   non-owner or signed-out caller gets a typed `{ status: "forbidden" }`; the job is never invoked
   for them. The action validates its one input (`session`, an optional `sessionDateSchema`) with
   the same `.strict()` Zod object the old POST body used, returning `{ status: "invalid_input" }`
   for anything else. `/configuracoes` sets `export const maxDuration = 300`, matching the cron
   route's own budget, since the action can run the same long job.

5. **`api/cron/ingest` drops its `POST` handler entirely.** `GET`, still behind the `CRON_SECRET`
   bearer, is Vercel Cron's own trigger and nothing else now; a `POST` to that route gets Next's
   default 405, never a code path that reads `CRON_SECRET` from a request a human sent.

6. **E2E signs in as the owner instead of holding `CRON_SECRET`.** A fixed `E2E_OWNER_EMAIL`
   account (added to the preview's `OWNER_EMAILS`) signs in through the same E2E-only
   verification-link route every other spec uses, then drives `/configuracoes`'s trigger form; a
   new `triggerIngestionAsOwner` helper opens that as a separate browser context so specs that need
   a session of their own (signals, decisions, backtest, compare, scoring) can still register their
   own throwaway account alongside it.

## Consequences

- The owner must set `OWNER_EMAILS` in Vercel (Production and Preview) before this ships anywhere
  it matters, and add the owner's own address to it; skipping this leaves the manual trigger
  unreachable by anyone, which is the safe failure direction.
- `CRON_SECRET` must be rotated once this lands: it was handled by a human (via the removed `POST`
  and the E2E specs' bearer header) up to this point, and a secret a human held is assumed
  compromised the moment it stops being the only path to a privileged action.
- `apps/web/e2e/README.md`'s `CRON_SECRET` environment variable entry is removed; `E2E_OWNER_EMAIL`
  replaces it as the one additional variable `signals.spec.ts`, `decisions.spec.ts`,
  `scoring.spec.ts`, `backtest.spec.ts` and `compare.spec.ts` need beyond `E2E_SECRET`.
- `CONTEXT.md`'s description of the manual trigger is updated from "the owner's manual trigger:
  same bearer" to the session-authenticated Server Action described here.
