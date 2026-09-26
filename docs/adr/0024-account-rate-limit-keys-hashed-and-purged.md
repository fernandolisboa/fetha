---
status: accepted
date: 2026-09-26
---

# Account rate-limit buckets are keyed by an email hash and purged after 60 seconds (amends 0018)

## Context

ADR-0018 added a per-account rate-limit bucket in `rate_limits`, keyed `${email}|${path}`, applied
in `hooks.before` to sign-in, magic link, password reset and verification resend before Better Auth
knows whether the address has an account. Server actions later reused it with `user.email` for
their own paths. Nothing in Fetha deleted those rows: Better Auth's own `deleteExpiredRows` runs
only when one of its IP buckets resets a window. On a deploy with one user, the table kept every
address ever typed into `/entrar`, including addresses of people with no account, indefinitely
(#64). That is personal data kept with no purpose once the 10 to 60 second window is over (LGPD
art. 6 III, art. 15), and a dump of the table lists who tried to sign in.

## Decision

1. The key is `account:<sha256(email) as base64url>|<path>` (`accountBucketKey` in
   `apps/web/src/modules/auth/account-rate-limit.ts`). The limiter only needs to recognise the
   same address again, never to read it back. The `account:` prefix cannot start an IP address,
   so account and IP buckets still never collide.
2. Whenever an account bucket starts a new window (first insert or window reset), the same call
   deletes every `account:` row whose `last_request` is older than
   `ACCOUNT_BUCKET_RETENTION_SECONDS` (60). IP buckets are left to Better Auth's own prune.
3. A rule whose window exceeds the retention is refused at call time, since the purge would
   otherwise delete a live bucket and reopen the limit. ADR-0018's constraint still holds as well:
   Better Auth's own prune deletes every row older than its longest window, account rows
   included, so account windows also stay at or below that (60 seconds today).
4. Migration `0014_purge_plaintext_rate_limit_keys` deletes the rows still keyed by an address.

## Considered options

- **HMAC with `BETTER_AUTH_SECRET` instead of a plain hash.** A plain SHA-256 still lets someone
  holding a dump confirm a guessed address. Rejected for now: rows live at most about a minute
  after their last request, so a dump holds only the last minute of attempts, and threading the
  secret through the seven call sites buys little on top of that.
- **Purge from the daily ingestion cron.** Rejected: rows would live up to a day, and the cron
  exists for market data, not for auth housekeeping.

## Consequences

- `rate_limits` holds no address in clear, and an account row outlives its last request by at
  most 60 seconds plus the time until the next account window starts anywhere.
- One extra `DELETE` per new account window. The table stays small, so no index is added.
- The privacy policy (#31) should state this retention.
