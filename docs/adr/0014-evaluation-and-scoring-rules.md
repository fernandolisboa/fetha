---
status: accepted
date: 2026-09-09
---

# Evaluation, backtest and scoring rules settled with the engine interface

## Context

Designing the engine interface (ADR-0013) surfaced ten product questions that ADR-0004 (backtest
hygiene), ADR-0005 (decision scoring) and ADR-0008 (strategy DSL) had left implicit. The owner
answered them on 2026-09-09. This ADR records the answers as rules the engine implements and the
types in ADR-0013 encode; where a rule sharpens an earlier ADR it says so.

## Decision

- **Thesis claim (Q36; amends ADR-0005).** A thesis carries free-text rationale and an optional
  machine-checkable claim from a closed vocabulary (`ThesisClaim` in `packages/contracts`):
  `close_above` or `close_below` a level for an instrument, evaluated on the instrument's nominal
  close at the horizon session; or `operation_pnl_positive`, evaluated on the operation's P&L at
  the horizon. The Brier component of a score uses the claim's outcome against the stated
  confidence. Without a claim the score has `thesis.held: null`, no Brier term, and only P&L
  counts; the journal shows the thesis as unscored, never as held or failed. Users never mark a
  thesis held by hand.
- **Walk-forward (Q37; sharpens ADR-0004 and the glossary).** In v1 walk-forward is rolling
  out-of-sample windows of the same strategy version: the run's period is cut into consecutive
  windows of `windowSessions` sessions and metrics are reported per window next to the whole-run
  metrics, so instability across windows is visible. Comparison across candidate strategies is
  done by hand-authoring versions and running each; there is no parameter optimization and no
  parameter space in the DSL (ADR-0008 stands).
- **Missed fill (Q38; amends ADR-0004).** When an entry signal cannot be filled because the
  selected series had no trades in the fill session, the entry is retried on each following
  session while the entry condition still holds at that session's evaluation, up to three
  sessions in total. After that, or as soon as the condition stops holding, the entry is recorded
  as a `MissedEntry` with `sessionsTried` and reason `no_trades`. Each attempt uses that session's
  own prices; nothing is filled retroactively.
- **Limit breach in warn mode (Q39; sharpens ADR-0004).** With `limits: "warn"` a breaching
  operation is filled at the requested size and the breach is recorded in the run's
  `limitBreaches` with its session and ticker, plus note `limit_breach_warned`. The operation is
  never sized down silently. With `limits: "enforce"` the entry is refused and recorded as a
  `MissedEntry` with reason `limit_breach`.
- **Counterfactual P&L for "do not enter" (Q40; sharpens ADR-0005).** The untaken operation is
  entered with the backtest fill model at the first fill opportunity after the decision. If the
  decision answered a signal, the operation is then closed by that strategy version's exit rules
  (or at expiry or the horizon, whichever comes first) and the counterfactual P&L is the realized
  result. If the decision came from a manually built structure, the operation is marked to market
  at the horizon session close. The decision's `origin` selects the rule; the cost model applied
  is the one stored with the decision.
- **Settlement proposal (Q41).** At an operation's expiry the engine proposes exercise for every
  long option leg and assignment for every short option leg that is in the money at the expiry
  session close by any amount, mirroring B3's automatic exercise; out-of-the-money legs expire
  worthless and stock legs are kept. Proposed fills carry the strike as price. The user confirms
  or corrects; the proposal never becomes a fill on its own.
- **Mark to market of an untraded series (Q42).** When an option series has no trade in the
  session being valued, its mark is the last traded price, flagged `stale` with the session of
  that trade, and the model fair value is reported alongside on the same leg. Totals use the
  stale mark; the UI shows both.
- **Single expiry per structure (Q43; sharpens ADR-0008).** Every leg of a structure shares one
  expiry; the `Structure` schema encodes it (`expiry: "shared"`). Calendars and diagonals are out
  of the v1 catalog. Payoff is therefore always computed at that one expiry; a payoff surface for
  multi-expiry structures would be a new `expiry` value in the schema and a superseding ADR.
- **Pricing without a risk profile (Q44).** The builder prices an operation whether or not the
  user has a risk profile. Without one, limit checks are skipped, `limitBreaches` is empty and the
  artifact carries note `no_risk_profile`. Pricing never refuses for that reason; sizing by a
  `SizingRule` does (`unsizeable`, reason `no_declared_capital`) because it has no capital to
  size against.
- **No matching option series in evaluation (Q45; sharpens ADR-0008).** When the entry condition
  holds but no listed series satisfies the strike and expiry selection, the evaluation records an
  `EvaluationRecord` with outcome `no_series_match` and the selection that failed in `detail`. It
  is not a signal, does not reach the inbox and is visible in the evaluation log.

## Consequences

ADR-0004 stays in force with three sharpened points (retry window for missed fills, warn-mode
semantics, walk-forward meaning). ADR-0005 stays in force with the thesis claim as the only source
of `thesis.held` and one explicit counterfactual rule. ADR-0008 stays in force with a single shared
expiry per structure and no parameter space. The glossary gains "Thesis claim", "Implied
volatility index", "Settlement proposal" and "Missed entry".
