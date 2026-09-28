---
status: accepted
date: 2026-09-28
---

# An inbox horizon for entry proposals, separate from the catch-up limit (#83, amends 0039)

## Context

`CATCH_UP_SESSION_LIMIT = 21` (`strategies/evaluate-signals.ts`, #19) did two jobs at once. As a
bound on how far back a nightly run evaluates, 21 sessions is right: it covers Carnaval plus a
week-long provider outage, and the clamp advances the watermark past whatever it drops, so a
tighter bound would lose sessions for good. As a bound on what reaches the inbox it is too
generous. An entry proposal from three weeks ago was priced at a spot that is now a month stale,
is sized against today's risk profile, and once option legs exist may name series no longer
listed. It landed in the same inbox as tonight's signal, distinguished only by its session, so a
user back from three weeks away found the one live signal buried among twenty dead ones for the
same ticker.

## Decision

- A second constant, `INBOX_ENTRY_SESSION_HORIZON = 5` (one trading week). The issue asked for a
  single-digit horizon and left the value open; five covers a long weekend or a missed night or
  two, and a proposal older than a week is stale by any reading of a daily strategy.
- The horizon counts calendar sessions back from the wall clock of the run, not from its `at`: an
  entry signal whose session is older than the fifth-newest session closed by now is past it. A
  provider that publishes a week late therefore cannot push a week of stale proposals into the
  inbox just because they are the newest data the run has. A calendar shorter than the horizon puts
  nothing past it.
- The catch-up still evaluates and logs every session up to `CATCH_UP_SESSION_LIMIT`. For an
  entry past the horizon it writes the evaluation record, with outcome `signal` and the new
  web-authored reason `entry_past_inbox_horizon` (detail: the horizon, so the log reads "older than
  the last 5 sessions"), and writes no row to `signals`. The engine is unchanged, so there is no
  `ENGINE_VERSION` bump; the reason joins `webEvaluationReasons` and needs no migration
  (`evaluations.reason` has no CHECK, Zod validates on read). This amends ADR-0039, whose web
  vocabulary until now held only codes for rows the engine never evaluated: this one is written
  over an engine record whose own reason was `signal`. The relabel relies on the engine emitting
  one record per (ticker, session); it is gated on that record's reason being `signal`.
- Only entry signals are filtered. The nightly run passes no open operations to the engine, so it
  produces no exit or adjustment signals today; when it does, whether a late exit is still worth
  showing is a separate decision.

## Consequences

- A catch-up of up to 21 sessions puts at most five sessions' entries per strategy and ticker in
  the inbox; the rest stay visible in the evaluation log with their reason.
- The watermark still advances over every evaluated session, so a proposal kept out of the inbox
  is never retried on a later night.
