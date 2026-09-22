---
status: proposed
date: 2026-09-22
---

# Operational settings change without a redeploy: one typed row in Postgres (amends 0016)

## Context

`REGISTRATION_MODE=open|invite|closed` (ADR-0016) is read from `process.env` at request time
(`apps/web/src/lib/env.ts`), but on Vercel "any change you make to environment variables are not
applied to previous deployments, they only apply to new deployments" (Vercel docs, environment
variables, checked 2026-09-22). Flipping the mode, for example `invite` → `open` before friends
register, or `open` → `closed` if something goes wrong, therefore means editing the variable in the
Vercel dashboard and redeploying production. `apps/web/scripts/vercel-ignore-build.sh` always builds
production, so every flip costs a full production build and several minutes before it takes effect,
and it needs someone with Vercel dashboard access at that moment.

The only read site today is the `hooks.before` middleware on `/sign-up/email`
(`apps/web/src/modules/auth/options.ts`), which already queries Postgres in the same request
(`hasPendingInvite`). Reads happen once per sign-up attempt: tens per year at the current scale, not
per page view.

Three realistic options on the current stack (Next.js on Vercel Pro, Neon Postgres):

|                            | A. Env var + redeploy (today)                                           | B. Typed row in Postgres                                                                                               | C. Vercel Global Config (formerly Edge Config)                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How a change is made       | Edit env in Vercel, redeploy production                                 | One `UPDATE`, run from a GitHub Actions button                                                                         | Edit in Vercel dashboard or REST API                                                                                                                                             |
| Time until it takes effect | One production build (minutes)                                          | Next request after commit                                                                                              | Up to 10 s global propagation (Vercel docs)                                                                                                                                      |
| Read latency               | None (process memory)                                                   | One primary-key lookup on the connection the hook already uses; low single-digit ms in-region (inferred, not measured) | ≤ 15 ms at P99, often < 1 ms (Vercel docs)                                                                                                                                       |
| Money                      | $0, but one production build per change against the team's build budget | $0: one row in the existing Neon project, no new resource                                                              | Usage-billed: $3 per 1M reads, $1 per 100 writes (vercel.com/pricing, 2026-09-22), drawn from Pro's monthly credit; rounds to $0 at this volume but is still a new paid resource |
| New dependencies           | None                                                                    | None                                                                                                                   | `@vercel/global-config`, a store per environment class, a `GLOBAL_CONFIG` connection string in each Vercel environment                                                           |
| Local dev and CI           | `process.env`                                                           | Same database CI already resets and migrates (ADR-0016)                                                                | Reads a real store over the internet with a token, or the client is stubbed; per-test flips hit a store shared by concurrent runs and the 100 writes/hour Pro limit              |
| Audit                      | Vercel env history                                                      | `updated_at` on the row plus the Actions run log (who, when, value)                                                    | Vercel store backups (90 days on Pro)                                                                                                                                            |
| Validation                 | Zod on read (`registrationModeSchema`)                                  | `CHECK` constraint in the database plus Zod on read                                                                    | Zod on read only; the dashboard accepts any JSON                                                                                                                                 |

## Decision

**B. Operational settings that must change without a deploy live in one typed row in Postgres.**

1. **Table `operational_settings`**, owned by the `auth` module while `registration_mode` is its
   only column (`modules/auth/schema/operational-settings.ts`, ADR-0019). Exactly one row, enforced
   by `id boolean primary key default true check (id)`. Columns are typed, not key/value:
   `registration_mode text not null check (registration_mode in ('open','invite','closed'))`,
   `updated_at timestamptz not null default now()`. A new setting is a new column in a migration;
   code must change to read it anyway, so a deploy happens then and a key/value store would only
   move validation from the database into application code.
2. **Operational class, not user data.** Like `invites` and `mail_outbox` (ADR-0016, "Operational
   tables"), it carries no `user_id`, only the system reads it and no user-facing action writes it.
   With no user data in it, the per-user isolation test does not apply, as for `invites`.
3. **Read on every use, no cache.** `registrationMode()` becomes an async read of the row inside the
   sign-up hook, validated with `registrationModeSchema`. A short in-process TTL cache was
   considered and rejected: at one read per sign-up attempt it saves nothing measurable, and every
   warm function instance would keep serving a stale mode for up to the TTL after a flip,
   which is the exact behavior this ADR exists to remove.
4. **Fail closed.** A missing row or a value that fails validation refuses sign-up as `closed` and
   logs an error; it never falls back to `open` or to an environment variable.
5. **The row is the only source.** The `REGISTRATION_MODE` environment variable is retired in the
   same change: two sources with a precedence rule is a configuration bug waiting to happen. The
   migration seeds `invite`, the current default. Before the migration reaches production, the
   implementer checks the production Vercel value; if it is not `invite`, the first run of the
   workflow below sets the row to match.
6. **How the owner flips it.** A `workflow_dispatch` GitHub Actions workflow,
   `set-registration-mode.yml`, with a `choice` input (`open`, `invite`, `closed`), running in the
   `production` environment with the `DATABASE_URL_PRODUCTION` secret that `migrate-production.yml`
   already uses. It runs a plain-JS script (`scripts/set-registration-mode.mjs`, the same shape as
   `seed-invite.mjs`) that updates the row and prints the old and new values. No new secret, no
   admin screen (YAGNI until an admin ticket exists). The Neon console SQL editor is the fallback.
7. **What stays in environment variables**: secrets (`DATABASE_URL`, `RESEND_API_KEY`,
   `CRON_SECRET`, `E2E_SECRET`) and per-environment wiring (`EMAIL_FROM`, `BETTER_AUTH_URL`). Those change
   together with a deploy or a rotation (Vercel's rotating-secrets procedure), not as a runtime
   switch.

## Consequences

- Flipping registration takes one click in GitHub Actions and applies to the next sign-up attempt,
  with no build and no Vercel access needed.
- Integration tests set the row instead of `process.env.REGISTRATION_MODE`. This is safe because
  `vitest.integration.config.mts` already runs files serially (`fileParallelism: false`).
- The shared `fetha-preview` database is reset on every CI run, so the reset step must set the row
  to `open` for the E2E suite, which today relies on `REGISTRATION_MODE=open` on the preview
  deployment (`apps/web/e2e/README.md`). That env var is removed from Vercel Preview and Production
  after the change ships.
- ADR-0016's sentence "`REGISTRATION_MODE` ... is read at request time" is amended by this ADR, not
  edited. The glossary term stays "registration mode"; `REGISTRATION_MODE` as an env var disappears
  from `CLAUDE.md`, `CONTEXT.md` and the E2E docs in the implementing PR.
- **When to revisit**: a setting read on every request, in middleware or the app shell (a
  maintenance page, a global kill switch), is where Global Config's sub-millisecond read earns its
  place and a Postgres round trip per page view would not. That setting gets its own ADR and the
  owner's approval for the usage-billed resource; this ADR does not pre-build for it.

## Alternatives considered

- **A. Keep environment variables only.** Zero code, and flips are rare. Rejected because each flip
  costs a production build and minutes of delay, and an emergency `closed` should not wait on a
  build or on Vercel dashboard access.
- **B with a short TTL cache.** Rejected, see Decision 3.
- **B as a key/value table (`key text`, `value jsonb`).** Rejected, see Decision 1: every new key
  ships with code anyway, and a typed column lets the database reject a bad value.
- **C. Vercel Global Config.** Its read speed is irrelevant for a read that sits next to a Postgres
  query the same hook already makes. It adds a dependency, a usage-billed resource that needs the
  owner's confirmation (CLAUDE.md), a store per environment class, and a test story (a shared
  store, write rate limits, network access from CI) that is worse than the database CI already
  resets on every run. Kept as the answer for per-request settings, see Consequences.
- **Vercel Flags / a third-party flag service.** Rejected: built for gradual rollouts and
  experiments across many users, which a single-user app with one three-valued switch does not
  have. The Flags Explorer alone is $250/month on Pro.
