---
status: accepted
date: 2026-09-28
---

# Re-evaluating a session is append-only, per user and strategy, and audited (#84)

Amends ADR-0027's description of `signals` and `evaluations` as append-only through
`onConflictDoNothing` alone: they now also allow a one-time `superseded_by` stamp, and triggers
enforce the rest.

## Context

After a bad candle is corrected, the signals and evaluation records the nightly run wrote from it
are wrong, and the per-version watermark (`lastEvaluatedSession`) keeps a normal run from ever
revisiting that session. PR #77 tried to fix this with a bearer-gated `force` flag on the
ingestion cron and was pulled after three review rounds: each fix opened another hole in the same
family (the watermark hole, stale signals it could not retract, a whole inbox's read state reset,
and every signal of a version deleted when the recomputation itself failed). The need stays: the
decision journal is scored against outcomes (CLAUDE.md principle 4), so a stored evaluation must
never silently change, and a failed recomputation must never empty an inbox.

## Decision

- **Scope and trigger.** A signed-in user re-evaluates one of their own strategies on one session
  it was already evaluated on, from the evaluation log on `/sinais` (one "Reavaliar" button per
  strategy and session). The Server Action `reevaluateSessionAction` takes the user from the
  session, is rate limited (`signals/reevaluate`, 10 per minute per account) and refuses an
  archived strategy (ADR-0043). There is no bearer or cross-user path; the owner's manual
  ingestion (ADR-0042) still does not touch evaluations.
- **Same inputs as the nightly run.** The session is recomputed through the same function the
  nightly run uses (`evaluateVersion`), over the versions and tickers that session's current
  records name, with the user's current risk profile, as the nightly run would. Records the
  catch-up clamp wrote (`catchup_clamped`) are never targets: they name sessions nobody evaluated.
  The engine is unchanged, so there is no `ENGINE_VERSION` bump.
- **Only an authoritative result may change anything.** If loading the market view or the engine
  fails, or a version's structure is gone, the attempt writes one `failed` row to the audit trail
  and touches nothing else. A ticker the recomputation has no record for keeps its rows.
- **Append-only by supersession.** `evaluations` and `signals` gain `superseded_by`, a reference
  to the re-evaluation that replaced the row, and `reevaluation_id`, the re-evaluation that wrote
  it. A changed evaluation record (outcome, reason or detail) is superseded and a new one written;
  a signal whose proposal or rule changed is superseded and replaced (its read state starts
  over); a signal the recomputation no longer produces is superseded with no replacement
  (retracted). A signal whose proposal is unchanged keeps its row, id and read state. Readers
  (inbox, unread count, signal detail, evaluation log) see only rows with `superseded_by` null;
  the uniqueness of a signal or record per (version, ticker, session, ...) holds among current
  rows only (partial unique indexes). Triggers make both tables append-only in the database: the
  only update allowed is stamping `superseded_by` once, plus `read_at` on signals.
- **Audit.** Every attempt writes a `signal_reevaluations` row (user, strategy, session,
  `applied | unchanged | failed`, failure reason, and counts of records superseded and signals
  retracted, replaced and added), in the same transaction as the rows it changes. It is the audit
  log #84 asks for; the user is the actor. The table is included in the account data export
  (ADR-0027) and deleted with the account.
- **The inbox horizon applies only to what would be written anew.** Re-evaluating an old session
  never retracts a signal just because it has aged, but a new or changed entry proposal from a
  session past the horizon (ADR-0044) is not written: its predecessor is retracted and its
  record takes the `entry_past_inbox_horizon` reason, exactly as the nightly run would have done.
- **Decisions are untouched.** A decision stores its own snapshot of the signal it answered, so
  superseding that signal changes nothing in the journal or its scoring. A superseded signal can
  no longer be answered.
- **Concurrency.** The write takes the user's `signals` advisory lock (`lockUserScope`) and stamps
  only rows still current; if another run superseded one first, the whole write rolls back, a
  `failed` audit row with reason `conflict` is written outside it, and the user is told to try
  again.

## Consequences

- A correction reaches the inbox without a bearer flag, a manual SQL fix or a watermark reset,
  and the old rows stay in the database for the journal to be scored against.
- Two re-evaluations of the same session with the same data are no-ops after the first: the
  second records `unchanged`.
- The recomputation anchors its data window on the previous session, as a one-night run would.
  A session the nightly evaluated inside a multi-session catch-up had a longer view, so a
  recursive indicator (EMA, RSI) seeded at the start of that view can differ slightly, and a
  condition sitting on its threshold may flip on re-evaluation with no data change. That drift
  already exists between nightly runs of different catch-up lengths; the fix belongs in the
  engine's data window (#239), not here.
- Superseded rows accumulate. They are bounded by the per-minute rate limit and by how often
  data is corrected; if they ever matter, pruning them is a separate decision.
