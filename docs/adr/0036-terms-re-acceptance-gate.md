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

1. **One module entry point.** `terms-gate.ts` exports `readTermsGate(db, user)`, returning
   `{ state: "current" } | { state: "stale" } | { state: "unconfirmed" }` — a discriminated union,
   not a raw `terms_version` string. Nothing outside `modules/auth` (the shell layout, the
   `/aceitar-termos` page, the Server Action) ever compares a `terms_version` to `null` or to
   `CURRENT_TERMS_VERSION` directly; they all switch on `.state`. `"unconfirmed"` is a NULL
   `terms_version` (a verified account whose owner has not accepted yet); `"stale"` is an older,
   non-null version. Read from the database, not the session cookie, the same way `hasPassword`
   does: a cookie minted at sign-in cannot know about a version bump that happens mid-session. This
   runs on document loads only, in the shell layout right after the `hasPassword` redirect,
   exactly like that check: an already-open tab, or a Server Action already in flight when a
   version bumps, is not interrupted mid-session — only the next full navigation re-reads the gate.
   A stale or unconfirmed gate sends the request to `/aceitar-termos`, a page outside the shell
   that uses `AuthShell` like `/definir-senha`.
2. **`user.termsVersion` and `user.termsAcceptedAt` become nullable** (`drizzle/0018_terms_version_nullable.sql`).
   This **amends ADR-0016's invariant** that the columns are `NOT NULL`: a row is still never
   _created_ with a null `termsVersion`, because `databaseHooks.user.create.before` still stamps
   both into the very first INSERT (unchanged). They go to `NULL` only at the unverified→verified
   flip, and stay `NULL` until the mailbox's own owner accepts through the new gate — closing
   ADR-0028's residual, because the consent of record is now always the verified owner's.
3. **Every proof of mailbox ownership clears the pair, gated by both the flag and the request
   path.** Better Auth's own `updateUser` internal adapter call is the single choke point both the
   verification link (`/verify-email`, `api/routes/email-verification.mjs`) and a magic-link
   sign-in of an unverified account (`/magic-link/verify`'s `revokeUnprovenAccountAccess` in
   `db/revoke-unproven-account-access.mjs`) go through, and both call sites read the current row
   first and return early when it is already verified — confirmed by reading both call sites in
   `node_modules/better-auth` at the pinned 1.7.3, not assumed. `options.ts` adds a pure,
   unit-tested `clearTermsOnVerifiedFlip(data, path)` (`databaseHooks.user.update.before`) that
   nulls the pair only when `data.emailVerified === true` **and** `path` is one of those two exact
   strings, read via `tryGetCurrentAuthEndpointContext()` from `@better-auth/core/context` (added
   as a direct dependency: the subpath is `@better-auth/core`'s own public export, pinned to
   `better-auth`'s own version, but not reachable through pnpm's resolution as a transitive
   dependency alone). The path check is a second, independent guard on top of the flag: a future
   plugin (admin, passkey, OAuth linking...) that flips `emailVerified` through `updateUser` on some
   other endpoint cannot silently null a verified user's consent just because it passed the flag —
   only these two known proof endpoints can. (`user.changeEmail`, if ever enabled, reuses
   `/verify-email` for its own confirmation step and would still clear terms there, since it is the
   same endpoint proving ownership of a — possibly new — mailbox; not a gap this ADR closes, since
   `changeEmail` is not enabled today.) Password reset on an unverified account never calls
   `updateUser` (it goes through `markEmailVerified` in `unverified-accounts.ts`, a raw UPDATE
   outside Better Auth's hook path), so that function clears the same two columns directly in the
   same statement.
4. **`/aceitar-termos` has two states**, both gated by a session and a password (else `/entrar` or
   `/definir-senha`), redirecting to `/` once the gate is `"current"`:
   - `"unconfirmed"` (the mailbox owner's first real acceptance): "Confirm your details", a name
     field left **empty** (not prefilled: the name on file at this state is the unproven
     registrant's, ADR-0028's own residual, never the mailbox owner's) and validated like sign-up's,
     plus both acceptance checkboxes.
   - `"stale"`: "The terms changed", a short summary of what changed in the current version next to
     links to `/termos` and `/privacidade` (`legal-text.ts`'s `termsChangeSummaryFor`, keyed by
     version and not itself the legally binding text), plus both checkboxes, no name field.
     Both states offer the same secondary path LGPD art. 18 requires without forcing acceptance
     first: export data (`GET /api/account/export`), delete the account (the existing
     `DeleteAccountDialog`, unchanged, confirmed to work outside the shell) and sign out. The page
     title is state-neutral ("Fetha · Termos de uso") rather than switching text, since it is set
     before the gate state is known to the browser tab/history entry.
5. **The accept is one atomic, conditional statement, owned by the repository.** No public method
   on `TermsAcceptanceRepository` takes a database or transaction handle: `acceptCurrent({ name? })`
   runs `UPDATE "user" SET terms_version = CURRENT, terms_accepted_at = now() (, name) WHERE id =
$me AND terms_version IS DISTINCT FROM CURRENT RETURNING id` (`IS DISTINCT FROM`, not `<>`,
   because `<>` against a NULL `terms_version` is NULL, not true, and would silently match zero
   rows for the common "unconfirmed" case) inside its own `db.transaction`, and inserts the
   `terms_acceptances` history row only when that UPDATE returned a row. Zero rows means either the
   account is gone (a concurrent deletion) or another accept already won the race (a double
   submit): the repository re-reads by id to tell the two apart and returns
   `"user_not_found" | "already_current"` rather than writing a second history row or guessing.
   `terms-consent.ts`'s `acceptTerms(db, user, { name? })` is the one caller: it reads the gate
   first and owns the name-required business rule (required only in the `"unconfirmed"` state,
   decided against the database-read gate, never against a hidden form field), then maps the
   repository's outcome to `{ status: "ok" | "already_current" | "name_required" | "unauthenticated" }`
   for the Server Action, which redirects to `/entrar` on `"unauthenticated"` like every other
   action that loses its session mid-flight.
6. **Equality, not recency.** The gate compares `terms_version` for exact equality with
   `CURRENT_TERMS_VERSION`, never a "newer than" comparison: versions such as `"2026-09-27.3"` do
   not sort lexicographically by calendar date once the revision suffix is involved, so any
   ordering comparison would be wrong on some future pair of versions. See the rollback
   consequence below.

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
- **Read `ctx.path` by threading it through a plain function parameter from `hooks.before`
  (`createAuthMiddleware`, which already has it) instead of `@better-auth/core/context`**:
  `databaseHooks` and `hooks.before`/`hooks.after` are separate pipelines with no shared mutable
  request-scoped state in this codebase's usage, and building one (a `WeakMap`, `AsyncLocalStorage`
  of our own) to smuggle a value between them is more machinery than depending on the same
  async-local-storage accessor Better Auth itself already uses for exactly this purpose.

## Consequences

- ADR-0028's "Consequences" item ("an attacker who registers someone's email first still leaves
  their chosen name and their own terms acceptance on the account the owner later completes...
  until then this is an accepted gap") is closed: the owner's name is only ever written by
  `acceptTerms` when they choose to confirm or change it, and the terms acceptance on the account
  from that point on is always the owner's own.
- **Honest registrants accept twice.** Someone who signs up for their own email, with no attacker
  in the picture, still clicks the checkboxes at `/cadastro` and, once verification nulls the
  columns, again at `/aceitar-termos` — two `terms_acceptances` rows for one registration. This is
  by design, not a bug to fix: the sign-up consent is provisional (nobody has proven the mailbox
  yet) until the verification step both proves it and, as a side effect, asks for it again. The
  history table is append-only and already tolerates more than one row per user (a real version
  bump does the same).
- **The history table can carry rows for a consent that was never the account's owner's.** A
  `terms_acceptances` row written before verification (at sign-up, by
  `recordTermsAcceptanceHistory`) records whoever clicked the checkboxes at that moment, which may
  be an attacker (ADR-0028). The consent of record for authorization and display purposes is
  always `user.terms_version`/`user.terms_accepted_at`, never a read of this history table's latest
  row; nothing in the codebase treats history rows as authoritative on their own.
- A user who verifies but never opens `/aceitar-termos` again holds an `"unconfirmed"` gate
  indefinitely; nothing purges such an account the way the unverified-account purge does, because
  it is fully verified and may hold real data.
- **Rolling `CURRENT_TERMS_VERSION` back to an older, already-superseded value** (equality
  semantics, decision 6) would flip every user who accepted the version being rolled back _past_
  from `"current"` to `"stale"`, sending them back through the gate even though they already saw
  and accepted a later version; a rollback that needs to avoid this must restore the exact string
  every affected user's `terms_version` already carries, not merely revert `terms.ts`.
- `CURRENT_TERMS_VERSION` is unchanged by this ticket: the legal text itself (`legal-text.ts`) did
  not change, only the mechanism that asks users to re-accept it next time it does.
