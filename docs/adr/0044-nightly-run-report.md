---
status: accepted
date: 2026-09-28
---

# `nightly_runs`: a redacted run report recorded by every nightly run (#220)

## Context

`ingestion_runs` (docs/adr/0017) records per-source ingestion, but nothing records the whole
nightly run: purges, ingestion, signal evaluation and decision scoring, whether it was Vercel Cron
or the owner's manual trigger (ADR-0042) that started it. Agents cannot read Vercel's runtime logs
after the fact, so "did last night's job run and what failed" needed an owner screenshot.

## Decision

- **`nightly_runs`**, owned by the `nightly` module (`apps/web/src/modules/nightly/schema/`):
  `id`, `trigger` (`cron` | `manual`, closed vocabulary held by a `CHECK` constraint the same way
  `access_log.event` is, ADR-0027), `started_at`, `finished_at`, `ok`, `report` (`jsonb`). No
  `user_id`: this is the ADR-0016 class of operational table the system alone writes and no user
  reads — `invites`, `mail_outbox`'s class, not a domain table — so it carries none of that ADR's
  tenant-isolation apparatus and is naturally excluded from the account export and deletion table
  scans, both of which key off a `user_id`/`…_user_id` column.
- **One row per run, written from one place both callers share.** `runNightlyJobRecorded(db,
trigger, options)` (`modules/nightly/recorded-run.ts`) wraps `runNightlyJob`: both the cron
  route's `GET` and the owner's manual `triggerNightlyJobAction` call it instead of `runNightlyJob`
  directly, passing their own `trigger`. Recording never changes the run's own response or status
  code: `recordNightlyRun` (`nightly-runs-repository.ts`) catches its own insert failure, logs it
  with `console.error` (no row data beyond the error's name), and returns — the caller always gets
  the same `NightlyJobOutcome` it would have without this ticket.
- **The report is redacted before it is ever written**, validated by a Zod schema
  (`nightlyRunReportSchema`, `modules/nightly/report.ts`) built from the real outcome types
  (`SourceOutcome`, `EvaluateSignalsOutcome`, `ScoreDecisionsOutcome`, the three existing purge
  outcomes and the new one below) rather than storing any of them whole:
  - per source: `source`, a closed `status` (`ok` | `skipped` | `pending` | `failed`, the same
    derivation `triggerNightlyJobAction`'s own summary already used, now shared as
    `sourceRunStatus`, extended for `SourceOutcome.pending` — a provider that has not published a
    session's data yet, #216 — the same way that summary's own union was),
    `rowCount`, `skippedRows?`, and `error?` — `SourceOutcome.error` only, already sanitized by
    `safeDbErrorMessage` (`@/db/pg-error`, #211/#224) to a Postgres SQLSTATE plus constraint or a
    truncated message, never a raw provider payload.
  - `session`, `okSessions`, and every purge outcome (`ok` + a count, never an id).
  - evaluation and scoring are reduced to counts only (`signalsWritten`, `strategiesDeferred`,
    `usersSkipped`, an `errorCount`; `decisionsScored`, `usersSkipped`, `decisionsSkipped`, an
    `errorCount`) — never `EvaluateSignalsOutcome.errors` or `ScoreDecisionsOutcome.errors`
    themselves, since the latter carries `decisionId`, another user's row id. No user id, decision
    id or email is ever written to this table.
- **A run that throws is still recorded.** `runNightlyJobRecorded` catches whatever `runNightlyJob`
  throws, records `{ ok: false, report: { error: <sanitized> } }` — the message reduced by the same
  `safeDbErrorMessage` a Postgres error would get anywhere else in this codebase — and rethrows the
  original error unchanged, so the cron route's behavior on throw does not change.
- **The same run purges its own table.** `purgeExpiredNightlyRuns` (90 days,
  `NIGHTLY_RUN_RETENTION_DAYS`, mirroring `ACCESS_LOG_RETENTION_DAYS`) runs inside `runNightlyJob`
  alongside the other three retention purges and reports through `NightlyJobOutcome.nightlyRunPurge`
  the same `{ ok, deleted }` shape they do — never a 500 on its own failure.
- **A read-only role, no login of its own.** The same migration that creates the table creates
  `nightly_report_reader` (`NOLOGIN`, idempotent through a `DO` block checking `pg_roles` — Postgres
  has no `CREATE ROLE IF NOT EXISTS`) and grants it `USAGE` on `public` and `SELECT` on
  `nightly_runs` only. It can read nothing else in either database. A login role granted this one —
  its own password, its own connection string — is created by the owner later, outside this ticket,
  and its URL goes into the agents' environment as `FETHA_REPORT_DB_URL`, letting an agent read last
  night's run without touching the write path or any other table.

## Considered options

- **Recording inside `runNightlyJob` itself.** Rejected: that function is already the shared,
  heavily-tested purge → ingest → evaluate → score sequence (ADR-0042), and its own tests construct
  a bare `{}` fake `Database`; adding a real insert there would force every one of those tests to
  also mock the repository, for a concern (where the run came from, whether to persist it) neither
  the cron route nor the manual action needs `runNightlyJob` itself to know. A thin wrapper keeps
  that function pure orchestration and gives both callers one place to share.
- **Storing the full `NightlyJobOutcome`.** Rejected for the same reason
  `TriggerNightlyJobSummary` (ADR-0042) does not: `scoring.errors` carries another user's
  `decisionId`, and a source's raw error before sanitization can echo a provider payload. A
  database row an agent can read is a wider audience than the server logs the full outcome already
  reaches, so the redaction has to be at least as strict as the client-facing summary's, and in
  practice is stricter (no session/date leaves either summary, but this report keeps them, since
  they identify a run, not a user).

## Consequences

- `apps/web/drizzle/0027_nightly_runs.sql` ships the table, its index on `started_at`, the trigger
  check constraint, the role and its grants in one migration — additive only (a new table and a new
  role), so it is safe under the expand/contract rule ADR-0016 states for `main`.
- `NightlyJobOutcome` grows a fourth purge field, `nightlyRunPurge`; every test that constructs one
  by hand (both `run-nightly-job.test.ts` and the cron route's/action's own test doubles) needed it
  added alongside the other three.
- The owner must create the login role and set `FETHA_REPORT_DB_URL` before any agent can read this
  table directly; until then, the row exists but is reachable only through the app's own
  `DATABASE_URL` (e.g. a one-off query), the same as any other table.
