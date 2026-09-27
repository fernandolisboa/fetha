---
status: accepted
date: 2026-09-27
---

# Invites are spent by mailbox proof, not by sign-up (amends 0016, 0028)

## Context

An invite is a row in `invites` keyed by email (ADR-0016), and the sign-up hook marked it consumed
the moment a user row was created with that email. Anyone who knew or guessed an invited address
could register it first and burn the invite, so the invitee could no longer sign up (#39, raised by
the security lens on PR #36). #39 proposed single-use random invite tokens delivered by email.

Since ADR-0028, registering someone else's email gains the registrant nothing: no password they
choose survives the mailbox owner's verification, and an account nobody verifies is purged after
24 hours. What was left of the threat was the burnt invite.

## Decision

An invite is spent only when someone proves they own its mailbox:

- `databaseHooks.user.update.after` calls `consumePendingInviteSafely` when the updated user is
  verified. Better Auth flips `email_verified` through that hook both on the verification link and
  on a magic-link sign-in of an unverified account.
- `onPasswordReset` calls it after `markEmailVerified`, which writes directly and so runs no hook.
- `databaseHooks.user.create.after` no longer consumes the invite.

A stranger who registers an invited email first leaves the invite pending. The invitee's own
sign-up then resends the verification link to that pending account (ADR-0028), and opening it
spends the invite with the account's id. `hasPendingInvite` and the invite-mode sign-up policy are
unchanged. `consumePendingInvite` still matches only a pending row, so a spent invite is never
spent again. An invite spent at sign-up before this change may belong to an account the purge
later deletes. The foreign key leaves that invite with no owner, and the purge then reopens every
spent invite without one. It runs this step after the delete, so an account that verifies in
between keeps its invite.

## Considered options

- **Random, single-use, expiring invite tokens in the link** (#39's proposal): an invite email
  flow, a token table with expiry and a sign-up field, all to stop an attack that email-first
  registration already made pointless. Invites are seeded by hand today and production registration
  is `open` (ADR-0020), so this is kept for an invite-management ticket, if one ever lands.
- **Keep consuming at sign-up and rely on the purge to reopen**: the invitee would be locked out
  for up to 24 hours.

## Consequences

- Invites still do not expire; #39's expiring tokens are not adopted. Nothing needed expiry once a
  stranger could not burn the invite, and the owner deletes a row to revoke one.
- Every update Better Auth makes to a verified user runs one `UPDATE` on `invites`, which matches
  nothing once the invite is spent.
