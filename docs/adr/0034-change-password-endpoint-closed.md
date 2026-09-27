---
status: accepted
date: 2026-09-27
---

# The change-password endpoint answers 404 (amends 0027)

## Context

Finding C-02 of the 2026-09-27 audit (#145). Better Auth's `/change-password` answered "wrong
current password" to whoever held a session, bounded only by its per-IP rule, so a stolen
session cookie could test password guesses from rotating IPs. ADR-0027 closed the same oracle on
`/delete-user` with a per-account bucket. No screen in Fetha changes a password: password reset
is the only way to set a new one.

## Decision

- `/change-password` answers 404 from the same `hooks.before` rule that closes
  `/delete-user/callback` (ADR-0027, item 3).
- No per-account bucket: it would guard an endpoint nothing calls. The audit named closing the
  endpoint while no screen exists as an acceptable remedy.

## Consequences

- A signed-in user changes a password through password reset.
- A future change-password screen reopens the path and must bring the per-account bucket that
  `/delete-user` has.
