---
status: accepted
date: 2026-09-27
---

# Expired sessions purged nightly; session lifetime pinned at 7 days (amends 0027)

## Context

Finding C-04 of the 2026-09-27 audit (#146). Better Auth deletes an expired session only when
its cookie is presented again, so a session abandoned in another browser kept its IP address and
user agent for as long as the account existed. ADR-0027 listed the retentions the privacy policy
states and left sessions out.

## Decision

- `purgeExpiredSessions` (`auth/expired-sessions.ts`), a system job over every user, deletes each
  `session` row whose `expires_at` has passed. The nightly cron reports it as `sessionPurge`; a
  failure is logged and never fails the run.
- The cron now runs all three retention purges (access log, unverified accounts, sessions) before
  ingestion rather than after it, so a night ingestion throws still deletes what the policy says
  is deleted nightly.
- No grace period after expiry: an expired session serves nothing, and Better Auth would delete it
  on sight.
- `session.expiresIn` is pinned at 7 days (`auth/session-lifetime.ts`), Better Auth's default, so
  the policy can state it. With the default one-day `updateAge`, a session in use keeps moving its
  expiry, so the policy says a session ends on sign-out or after at most 7 days without use.
- The privacy policy states both, and `CURRENT_TERMS_VERSION` becomes `2026-09-27.2`, since the
  date alone was already taken by the version published earlier the same day.

## Consequences

- An abandoned session's IP address and browser live at most about 8 days after its last use.
- A later change to the session lifetime must change the policy text too; `legal-text.test.ts`
  fails otherwise.
