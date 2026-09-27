---
status: accepted
date: 2026-09-27
---

# A signed-in gate asks existing users to re-accept a new terms version (amends 0016, 0028)

## Context

`CURRENT_TERMS_VERSION` (`terms.ts`) can change after a user has already accepted an earlier one:
ADR-0016 stamps `user.termsVersion`/`user.termsAcceptedAt` at sign-up and never touches them
again, so a version bump left every existing account carrying a stale acceptance with nothing
asking them to look at what changed (#142).

ADR-0028 also left a residual gap of its own: the consent stamped by whoever first posts to
`/sign-up/email` for an email they do not own is unproven until the mailbox owner opens the
verification link, opens a magic link, or resets the password (docs/adr/0028's "Consequences").
Until now that consent survived the proof intact — the owner inherited an attacker's checkbox
click, not their own.

## Decision

1. **The gate reads the database, not the session cookie**, the same way `hasPassword` does: a
   cookie minted at sign-in cannot know about a version bump that happens mid-session.
   `terms-gate.ts` adds `readTermsVersion` and the pure predicate `isCurrentTermsVersion`; the
   shell layout (`app/(shell)/layout.tsx`) calls `needsTermsReacceptance` right after the
   `hasPassword` redirect and sends a stale or missing acceptance to `/aceitar-termos`, a page
   outside the shell that uses `AuthShell` like `/definir-senha`.
2. **`user.termsVersion` and `user.termsAcceptedAt` become nullable** (`drizzle/0018_terms_version_nullable.sql`).
   This **amends ADR-0016's invariant** that the columns are `NOT NULL`: they still can never be
   null on an account that has not yet been verified, because `databaseHooks.user.create.before`
   still stamps both into the very first INSERT (unchanged). They go to `NULL` only at the
   unverified→verified flip, and stay `NULL` until the mailbox's own owner accepts through the new
   gate — closing ADR-0028's residual, because the consent of record is now always the verified
   owner's.
3. **Every proof of mailbox ownership clears the pair.** Better Auth's own `updateUser` internal
   adapter call is the single choke point both the verification link
   (`beforeEmailVerification`/`emailVerification.mjs`) and a magic-link sign-in of an unverified
   account (`revokeUnprovenAccountAccess` in `db/revoke-unproven-account-access.mjs`) go through,
   and both call sites read the current row first and return early when it is already verified — so
   a new `databaseHooks.user.update.before` in `options.ts` that nulls the pair whenever
   `data.emailVerified === true` never re-fires on an already-verified row. Confirmed by reading
   both call sites in `node_modules/better-auth`, not assumed. Password reset on an unverified
   account never calls `updateUser` (it goes through `markEmailVerified` in
   `unverified-accounts.ts`, a raw UPDATE outside Better Auth's hook path), so that function clears
   the same two columns directly in the same statement.
4. **`/aceitar-termos` has two states**, both gated by a session and a password (else `/entrar` or
   `/definir-senha`), redirecting to `/` once the version is already current:
   - `termsVersion` NULL (the mailbox owner's first real acceptance): "Confirm your details", a
     name field prefilled with the current name and validated like sign-up's, plus both
     acceptance checkboxes.
   - An older, non-null version: "The terms changed", a short summary of what changed in the
     current version next to links to `/termos` and `/privacidade` (`legal-text.ts`'s
     `termsChangeSummary`, not itself the legally binding text), plus both checkboxes, no name
     field.
     Both states offer the same secondary path LGPD art. 18 requires without forcing acceptance
     first: export data (`GET /api/account/export`), delete the account (the existing
     `DeleteAccountDialog`, unchanged, confirmed to work outside the shell) and sign out.
5. **`acceptTermsAction` → `acceptTerms` (`terms-consent.ts`)** runs one transaction: `UPDATE user
SET terms_version = CURRENT, terms_accepted_at = now() (, name)` plus a
   `TermsAcceptanceRepository.record` call through the same transaction handle (the repository's
   `record` now takes an optional `db`/`tx` override, the same `DbOrTx` pattern
   `strategies-repository.ts` already uses), so the durable acceptance and its history row can
   never disagree. Both checkboxes are required; the name is required only when the database says
   the version is NULL, decided server-side against the database, never against a hidden form
   field.

## Considered options

- **Keep the gate in the session cookie** (set a flag at sign-in): cannot react to a terms version
  bump that happens while the user is already signed in, and duplicates state the database already
  has.
- **Silently re-stamp the current version on next sign-in** instead of asking: fails LGPD art. 18's
  informed-consent expectation and does not close ADR-0028's residual, since the re-stamp would
  copy forward whatever the last write happened to be.
- **A NOT NULL column with a sentinel "unaccepted" version string** instead of NULL: reintroduces
  exactly the "a row always carries some string" ambiguity ADR-0016 designed away from; NULL says
  "no owner has accepted" without a magic value to keep in sync with `terms.ts`.

## Consequences

- ADR-0028's "Consequences" item ("an attacker who registers someone's email first still leaves
  their chosen name and their own terms acceptance on the account the owner later completes...
  until then this is an accepted gap") is closed: the owner's name is only ever written by
  `acceptTerms` when they choose to confirm or change it, and the terms acceptance on the account
  from that point on is always the owner's own.
- A user who verifies but never opens `/aceitar-termos` again holds a NULL acceptance
  indefinitely; nothing purges such an account the way the unverified-account purge does, because
  it is fully verified and may hold real data.
- `CURRENT_TERMS_VERSION` is unchanged by this ticket: the legal text itself (`legal-text.ts`) did
  not change, only the mechanism that asks users to re-accept it next time it does.
