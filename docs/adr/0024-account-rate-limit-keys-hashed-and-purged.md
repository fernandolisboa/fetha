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
   `apps/web/src/modules/auth/account-rate-limit.ts`) (superseded by the 2026-09-28 addendum:
   HMAC-SHA256 under BETTER_AUTH_SECRET). The limiter only needs to recognise the same address
   again, never to read it back. The `account:` prefix cannot start an IP address, so account and
   IP buckets still never collide.
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

## Addendum 2026-09-28: switch to HMAC-SHA256 (#191)

The "considered options" above rejected keying on `HMAC(BETTER_AUTH_SECRET, email)` on the
reasoning that a bucket lives at most about a minute, so a dump exposes only the last minute of
attempts. That undersold the risk: a plain `sha256(email)` is reversible by anyone who can read the
table, by dictionary, in that same minute, against the small, guessable universe of email addresses
that actually matter (the owner's own, and any invited address) — the retention window bounds _how
long_ the table is exposed, not _whether_ a captured row can be reversed once read.

`accountBucketKey` now computes `HMAC-SHA256(BETTER_AUTH_SECRET, "fetha:account-rate-limit:v1:" +
email)`: a single HMAC call over a label-prefixed message, rather than a two-step derivation (an
HMAC of the label to produce a derived key, then a second HMAC of the email under that key). The
single-step form gives the same guarantee — the digest cannot be reversed without
`BETTER_AUTH_SECRET` — with one call instead of two; the version label still domain-separates this
digest from any other value ever computed off the same secret, so rotating the derivation later
cannot collide with a key already in the table.

No new environment variable: `BETTER_AUTH_SECRET` already exists in every environment (it is
Better Auth's own signing secret) and this reuses it under a distinct, versioned label rather than
introducing a second secret to provision and rotate.

No data migration: rows written under the old `sha256(email)` digest simply stop matching any key
`accountBucketKey` computes going forward, so they are orphaned rather than actively wrong, and age
out within `ACCOUNT_BUCKET_RETENTION_SECONDS` (60s) the same as any other stale bucket (item 2
above already purges rows on that schedule; nothing in this change touches it).

`accountBucketKey`, `enforceAccountRateLimit` and `refundAccountAttempt` read `BETTER_AUTH_SECRET`
from an `env: AuthEnv = process.env` parameter — the same optional-env-with-`process.env`-default
shape already used by `isOwner`, `buildAuthOptions` and the other readers in `env.ts` — rather than
taking the secret as an argument, so `hooks.before`/`hooks.after` (which pass their own injected
`env`) and the seven Server Action / Route Handler call sites (which rely on the default) always
derive the identical key for the same email and path, and every consumer's call site is unchanged
by this addendum.

An unset or empty `BETTER_AUTH_SECRET` now throws before any bucket is read or written, rather than
hashing under an empty-string key: at first deploy of this change, and again on any future
`BETTER_AUTH_SECRET` rotation, every bucket already in the table was keyed under the old digest (or
the old secret) and is abandoned rather than matched, so an account sitting at its limit gets up to
`rule.max` extra attempts inside the one 60-second window live at that moment — bounded and
one-time, not a standing weakening of the limit.
