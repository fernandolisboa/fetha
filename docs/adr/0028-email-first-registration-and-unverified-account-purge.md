---
status: accepted
date: 2026-09-27
---

# Email-first registration and purge of unverified accounts (amends 0016, 0018, 0027)

## Context

Security audit 2026-09-27, C-01 (#144): with registration `open` (ADR-0020), anyone could sign up
someone else's email with a password of their choosing. Verification only flipped
`email_verified`, so when the mailbox owner later clicked the link the registrant's password kept
working, and a magic-link sign-in did not remove it either: Better Auth's
`revokeUnprovenAccountAccess` runs only on the magic-link path and only while the account is still
unverified. Unverified accounts were also kept forever (A-09, #39), which is what let an attacker
wait for the victim.

## Decision

The rule: **a password on a verified account was set by someone who proved they own the mailbox.**

1. **Email first.** The sign-up form asks for name, email and the two acceptances, no password.
   `signUp` sends Better Auth a random 32-byte password that is never stored anywhere else or
   shown, since `/sign-up/email` requires one.
2. **The verification link revokes unproven access.** `emailVerification.beforeEmailVerification`
   deletes every `account` row of the user being verified (`revokeUnprovenAccountAccess` in
   `auth/unverified-accounts.ts`, Better Auth's magic-link cleanup minus the sessions), so a
   password posted straight to `/api/auth/sign-up/email` dies at verification. Sessions are left
   alone: an unverified account cannot hold one, and the only one that can exist at that point is
   the one a concurrent open of the same link (a mail client's prefetch and the person's click)
   just minted for the mailbox owner. `autoSignInAfterVerification` is on: Better Auth runs the hook and mints a session
   only on the click that flips `email_verified`; later clicks of the same link only redirect.
3. **The opener chooses the password.** `/verificar-email/resultado` sends a signed-in user with
   no password to `/definir-senha`, which calls Better Auth's server-only `setPassword` with that
   session (`setInitialPassword`) and refuses a second password. The signed-in shell layout sends
   every session without a password to the same page, so no screen is reachable without one and
   account deletion keeps its mandatory password (ADR-0027): an owner who lost the link's session
   (another device, a mail scanner that opened the link first) and signed in by magic link lands
   there too.
4. **Password reset verifies** (amends 0018). `onPasswordReset` marks the account verified: the
   reset token was delivered to the mailbox, and the password it sets replaces any other.
5. **A second sign-up keeps the pending account.** When `/sign-up/email` is allowed for an email
   whose account is still unverified, the before-hook sends that account a fresh verification link
   (`sendVerificationEmailFn`) and Better Auth answers with its generic duplicate response. The
   pending row is never deleted and recreated: its id must not change while a verification is in
   flight, because Better Auth revokes by the id it loaded and flips `email_verified` by email.
   `/sign-up/email` gets a per-account limit (3 per 60 s, ADR-0018's table) so a rotating-IP
   client cannot turn it into a mail cannon for one address.
6. **Purge (#39).** The nightly cron deletes accounts still unverified 24 hours after creation
   (`purgeUnverifiedAccounts`, reported as `unverifiedAccountPurge`, never failing the run) and
   their pending reset tokens, and puts back to pending any invite such an account had consumed,
   so the invitee can still register. An unverified account never had a session, so it owns no
   domain data, and the cascade from `user` takes its terms history. It does not reuse
   `deleteOperationalRowsOf` (ADR-0027), which deletes the invite instead. 24 hours rather than the one-hour link lifetime keeps a
   resent link usable through the day; the hijack no longer depends on the purge. The privacy
   policy states the rule.

`setInitialPassword` is the one call in `auth/service.ts` that goes through `auth.api` instead of
the handler (ADR-0016's rate-limiting rule): `setPassword` is server-only, so the router cannot
serve it, and it needs the session the link just minted. The Server Action checks `hasPassword`
before calling it, so a signed-in user cannot drive repeated password hashing through it.

## Considered options

- **Keep the password at sign-up and ask for it again at the link**: twice the typing, and the
  second password is still not the proof.
- **Ask for the sign-up password on the link page**: the owner who never chose it is locked out of
  their own email's account.
- **Replace the pending account on a second sign-up** (this PR's first draft): it let the latest
  submitter's name and consent win, but the id change raced with a verification in flight and
  reopened the hijack (security review of PR #149).

## Consequences

- An attacker who registers someone's email first still leaves their chosen name and their own
  terms acceptance on the account the owner later completes. The name is display text (ADR-0016
  keeps it out of emails) and the acceptance is re-asked by the re-acceptance gate of #142; until
  then this is an accepted gap.
- Every sign-in flow now ends with a password or a redirect to set one; magic link remains a way
  in, not a way around the password.
- E2E specs register through `/definir-senha` (`e2e/support.ts`, `confirmEmailAndSetPassword`).
