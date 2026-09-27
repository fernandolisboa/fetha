---
status: accepted
date: 2026-09-27
---

# Mail sent after the response; the sign-in account bucket counts failures (amends 0016, 0018)

## Context

#114 and finding C-03 of the 2026-09-27 audit; ADR-0018 had deferred both problems to #45, from
which #114 split them out. Magic link, password reset and sign-up answered with the same body
whether or not the email had an account, but only the account branch awaited the Resend call, so
latency told the two apart. Separately, the per-account `/sign-in/email` bucket (3 per 10 s,
ADR-0018) counted every attempt, so the owner's own successful sign-ins used it up.

## Decision

- In production `getMailer` returns `AfterResponseMailer` around `ResendMailer` (ADR-0016 had the
  bare `ResendMailer`): `send` hands the Resend call to Next's `after()` and resolves at once.
  Every path that sends (verification, reset, magic link, the resend on a repeated sign-up)
  returns without waiting on the network. A failed send is logged with Resend's error name (never
  its message, which can quote the recipient); the requester already saw the generic answer.
- The capture mailer used by previews, local runs and tests stays synchronous, so tests and the
  E2E route read the link right after the request.
- `/sign-in/email` still reserves a slot in `hooks.before` through the guarded increment, which
  keeps concurrent guesses bounded. `hooks.after` gives the slot back when the request created a
  session; a failed refund is logged and never fails the sign-in. Three failures within the
  window still block the fourth attempt.

## Consequences

- Residual timing, not measured: a sign-up for a new email writes `user`, `account` and the
  terms history, which a repeated sign-up for a verified email skips. Both branches hash the
  password; the difference is a few database round trips.
- The refund decrements whatever the bucket holds, so each successful sign-in can give one extra
  guess to someone failing on the same account within the window. Bounded by the owner's own
  successful sign-ins, which an attacker cannot produce.
- The lockout a stranger can cause by sending wrong passwords for someone's email remains while
  they keep it up: those are failures and count. The owner can still get in by magic link or
  reset. A device cookie that exempts known browsers from the account bucket is the known fix,
  not built until the lockout is seen in practice.
- A send that fails after the response is visible only in the function logs. ADR-0027 kept the
  access-log write awaited for this very reason; a lost email differs because its owner can ask
  for another, while a lost access-log row cannot be recovered.
