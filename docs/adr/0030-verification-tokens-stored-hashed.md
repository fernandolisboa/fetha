---
status: accepted
date: 2026-09-27
---

# Verification tokens stored hashed (amends 0018)

## Context

ADR-0018 kept magic-link and password-reset tokens plain in the `verification` table and deferred
hashing to #60, only because the reuse and expiry integration tests locate the row by its plain
identifier. A database leak therefore yielded live, single-use links.

## Decision

- `verification: { storeIdentifier: "hashed" }` is on. Better Auth stores `defaultKeyHasher`
  (SHA-256, base64url without padding) of every identifier it writes, so a reset row holds the
  hash of `reset-password:<token>`.
- `magicLink({ storeToken: "hashed" })` is on too, as #60 asked. The plugin hashes the token
  before the store hashes it again, so a magic-link row holds SHA-256 of SHA-256 of the token.
  The second hash adds no strength; it is kept so the setting survives if the store option is
  ever narrowed to overrides.
- Tests reproduce the stored identifier with `storedIdentifier` (`auth/test-support.ts`, using
  `node:crypto`) and assert that no row carries the plain token.
- Email verification never used this table: its link is a signed JWT.

## Consequences

- A row written plain before the switch still resolves, because Better Auth retries the plain
  identifier when the hashed one finds nothing. Such rows expire within the hour.
- Code that clears verification rows (account deletion, the unverified-account purge) matches on
  `value`, not `identifier`, so it is unaffected.
