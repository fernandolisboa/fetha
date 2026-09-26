---
status: accepted
date: 2026-09-26
---

# LGPD: an access log written by read models, a per-module data export, deletion through Better Auth

## Context

Issue #31 asks for the LGPD set: terms and privacy text in the product, an export of all of a
user's data, account deletion that leaves no user-scoped row behind, and an audit log of access to
portfolio and decision data that the user can see. Every domain table already carries `user_id`
with `ON DELETE CASCADE` to `user` (ADR-0016), except `strategy_versions`, which cascades through
its `strategies` row. Operational tables (`invites`, `mail_outbox`, `rate_limits`) hold an email
address or its hash but no `user_id`.

The issue also carried a note from PR #77: a bearer-gated `force` mode of the signal evaluation
overwrote `signals` and `evaluations` in place, and the audit log had to cover it. That mode no
longer exists: both tables are append-only (`onConflictDoNothing` in `signals-repository.ts`), so
no operator path rewrites decision data today.

## Decision

1. **Access log.** A new leaf module, `audit`, owns `access_log` (`user_id`, `event`,
   `occurred_at`, `ip_address`, `user_agent`). The closed vocabulary is `portfolio_read`,
   `decisions_read` and `data_export`, validated with Zod on read. The rows are written by the
   read models of `portfolio` and `decisions` (their `queries` files and `getMyHeldOperation`)
   through `recordAccess(event)`, which is memoized per request so a page that reads decisions
   three times writes one row. The repositories stay free of the write because system jobs
   (nightly evaluation and scoring) use them too, and would otherwise log automated processing as
   the user's own access. The IP is the first `x-forwarded-for` hop (Vercel sets it) and the user
   agent is cut to 512 characters. A row lives 180 days: each write purges that user's older
   rows, the same purge-on-write shape as ADR-0024. The user sees the latest entries under
   Configurações. The rows are deleted with the account.
2. **Export.** Each module exposes an `exportMy…(db, user)` function from its entry point that
   returns its own rows for that user; the `account` module assembles them into one JSON document
   (`format: "fetha-export/1"`) served as an attachment by `GET /api/conta/exportar`. The route
   takes the user from the session, applies the account rate limit and writes a `data_export`
   access-log row. Secrets never leave: password hashes, session tokens and OAuth tokens are
   omitted, session metadata (created, expires, IP, user agent) is kept. Numbers leave as stored:
   decimals as strings, centavos as integers. A test enumerates every table with a `user_id`
   column in `information_schema` and fails when the export lacks it, so a new table cannot be
   forgotten.
3. **Deletion.** Better Auth's `/delete-user` endpoint, called through the handler like every
   other auth call (ADR-0016, so its rate limit applies), with the password mandatory: a
   `hooks.before` rule refuses the call without a password or with a token, so neither session
   freshness nor an emailed link can stand in for it. `beforeDelete` deletes the `invites` and
   `mail_outbox` rows for the address. Deleting the `user` row cascades to every user-scoped
   table. A test enumerates every table with a `user_id` column and asserts no row is left for the
   deleted user, that `strategy_versions` of their strategies are gone, and that another user's
   rows (including a copy of the deleted user's shared strategy) survive.
4. **Terms and privacy.** The text lives in `auth/strings.ts` and describes what the code does,
   including the retention of `rate_limits` (ADR-0024) and `access_log`. `CURRENT_TERMS_VERSION`
   changes with the text, so each new acceptance records which text was accepted.

## Considered options

- **Log in the repositories.** The issue's wording. Rejected for the reason in item 1: the same
  repositories serve the nightly jobs, and a log that mixes the user's reads with automated
  processing answers neither "who looked at my data" nor anything else.
- **Log after the response (`after()`).** Saves one insert of latency per page, but a failed
  write would go unnoticed. The write is awaited so a read never happens without its record.
- **A generic export that reads every table with a `user_id`.** Less code, but it reads other
  modules' tables directly (ADR-0019) and would leak columns a module never meant to show, such
  as password hashes.
- **Soft delete with a grace period.** Recoverable, but it keeps personal data after the user
  asked for it to go, and needs a purge job. Deletion is immediate and final.
- **Deletion by emailed link.** Better Auth supports it, but production email only reaches the
  owner (Resend's onboarding sender) until a domain is verified. The password is the second
  factor already in hand.

## Consequences

- Every portfolio or decision page view costs one insert and one purge delete on `access_log`.
- A new user-scoped table fails the export and deletion tests until its module exports it.
- Existing acceptances point at the previous terms version; asking those users to accept the new
  text again is a follow-up, not part of #31.
- An operator path that ever writes a user's decision data must log to `access_log`, adding an
  actor column then.
