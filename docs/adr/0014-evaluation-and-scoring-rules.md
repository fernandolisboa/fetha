---
status: accepted
date: 2026-09-09
---

# Evaluation, backtest and scoring rules settled with the engine interface

## Context

Designing the engine interface (ADR-0013) surfaced eleven product questions that ADR-0004 (backtest
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
  sub-period metrics of the same strategy version: the run's period is cut into consecutive
  windows of `windowSessions` sessions and the run's metrics are reported per window next to
  the whole-run metrics, so instability across windows is visible; an operation belongs to the
  window where it opened. The windows are not out-of-sample tests: nothing is fitted on one
  window and tested on the next. Comparison across candidate strategies is done by
  hand-authoring versions and running each; there is no parameter optimization and no parameter
  space in the DSL (ADR-0008 stands).
- **Missed fill (Q38; amends ADR-0004).** When an entry signal cannot be filled because the
  selected series had no trades in the fill session, the entry is retried on each following
  session while the entry condition still holds at that session's evaluation, up to three
  sessions in total. After that, or as soon as the condition stops holding, the entry is recorded
  as a `MissedEntry` with `sessionsTried` and reason `no_trades`. Each attempt uses that session's
  own prices; nothing is filled retroactively. Each attempt re-instantiates the structure at that
  session's close (strikes from that session's chain, size from that session's prices and the
  run's current equity), so the other `MissedEntryReason`s arise at fill time too: `no_series_match`
  when no listed series satisfies the selection at the attempt's session, `degenerate_strikes`
  when two distinct strike ranks resolve to the same listed strike, `unsizeable` when the sizing
  rule yields zero units at that session's prices (or the max loss is unbounded under
  `fixed_risk`), `limit_breach` under `enforce` (Q39). In the live evaluator (`evaluateStrategy`)
  the same three failures are `EvaluationRecord`s, not missed entries, because nothing is filled
  there (Q45).
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
  is not a signal, does not reach the inbox and is visible in the evaluation log. The same holds
  for `degenerate_strikes` (two ranks collapsed onto one strike) and `unsizeable`.
- **Scoring without an operation (Q46; amends ADR-0005).** An analysis of a strategy version, or
  a decision that references no operation, is scored on its thesis claim only: `pnl`, `maxLoss`,
  `normalizedPnl` and `counterfactualPnl` are `null` with note `no_operation`, and the Brier
  component alone forms the score. ADR-0005's "realized P&L normalized by max loss" applies only
  when there is an operation to realize it on. A `normalizedPnl` is also `null` when the
  operation's max loss is zero (note `zero_max_loss`), since there is nothing to normalize by.
- **Intraday option fill volatility (amends ADR-0011).** ADR-0011 says an intraday option fill
  is priced at fair value with "that day's closing implied volatility"; that volatility is not
  visible before the session closes, so reading it would be look-ahead. The fill uses the latest
  implied-volatility index point visible at the fill instant (the previous session's close for
  any fill inside a session), the spot being the open of the fill candle, plus slippage, and
  carries `volatilitySource: "closing_iv_index"` and note `intraday_option_fill_at_fair_value`
  (ADR-0013, "Fills").
- **Implied-volatility rank (sharpens ADR-0008).** `iv_rank` is a 0-100 percentile rank of the
  underlying's implied-volatility index over `lookbackSessions` (formula in ADR-0013), so
  `iv_rank > 50` means the current index is above the median of its lookback.
- **No pyramiding in `evaluateStrategy` (Q47; permanent, not a #15 stopgap).** A strategy version
  never opens a second entry into an instrument that already has an open, active operation
  (ADR-0013 "Entry gating"): the entry condition is evaluated only when the instrument has no
  active open operation, for stock-only structures now and for structures with option legs once
  #23 lands. This is a product rule, not a limitation of the current implementation, so it is
  recorded here rather than in the #15 scope note.
- **Exit rule order (Q48; permanent, not a #15 stopgap).** `evaluateStrategy` and `runBacktest`
  both try an operation's exit rules in the strategy definition's own order; the first rule whose
  threshold or condition fires wins for that operation at that instant, and no further rule is
  evaluated. A strategy author controls precedence entirely by ordering the `exit` array; the
  engine never picks the "best" of several rules that would fire together.
- **`evaluateStrategy` always warns on a limit breach (Q49; permanent, not a #15 stopgap).**
  Unlike `runBacktest`, which takes `config.limits: LimitMode`, `evaluateStrategy` has no enforce
  mode: a signal is a proposal for a human to act on, so a risk-profile breach is always recorded
  (`limitBreaches`, note `limit_breach_warned`, Q39's warn semantics) and never blocks the signal
  from reaching the inbox. Refusing a signal outright would take the decision away from the user
  this seam exists to inform.
- **Exit rule bases for a stock leg (Q50).** `profit_target` and `stop_loss` are evaluated against
  a base computed once per operation from its entry legs, priced with `priceStockLegs` at the
  entry prices (never the current close, which would let the base drift as the position moves):
  `profit_target`'s base is `|netPremium|`; `stop_loss`'s base is `maxLoss` when it is finite, or
  `|netPremium|` when `maxLoss` is `"unbounded"` (a net-short stock position), since there is no
  other bounded figure to measure a stop against. A base of zero (a delta-neutral pair of legs at
  the same entry price) means the rule can never fire; the evaluation record's `detail` names the
  rule and says so, since `EvaluationRecord` carries no structured reason.
- **Corporate actions across an open position in `runBacktest` (Q51).** `Operation.legs` stay
  nominal at every step — the same scale `evaluateStrategy` already rebases its own exit-rule
  comparisons against (Q50, ADR-0013 "Exit rule evaluation") — so nothing is applied twice.
  `runBacktest` itself, wherever it marks, fills or realizes P&L for an open leg, uses that leg's
  effective share count `quantity / F` and effective entry price `entryPrice × F`, where `F` is
  the product of every visible split/reverse-split factor with `exDate` strictly after the
  operation's own `openedAt` and at or before the session in question (`splitFactorProduct`,
  shared with `evaluateStrategy`). A dividend-type factor is treated as reinvestment at the
  ex-date price: it changes `F` the same way a split does, and the run books no separate cash
  dividend. `F` need not divide `quantity` evenly; the effective count is never rounded mid-run.
  Where a fill or a close needs an integer number of shares to trade, the leg trades
  `floor(quantity / F)` shares and the fractional residue `quantity / F − floor(quantity / F)` is
  cash-settled at that same fill's price (the ex-date price for a factor realized exactly at
  entry-to-close, the session's own price otherwise) and folded into the operation's `pnl`; it is
  never dropped and never made to throw on caller-supplied quantities that do not divide evenly.
- **Exit-fill retry has no cap (Q52; permanent, not a #16 stopgap).** Q38's three-session retry
  window is explicit about _entries_ only. An exit signal that cannot fill (no trade at the next
  session's open) is retried at every following session's open — the same pending exit, the same
  legs, no new `EvaluationOutcome` — until it fills or the run's `period.to` sweeps the still-open
  operation closed with `period_end` (never a fill, never a cost, per the "Simulated operations"
  rule in ADR-0013). There is no `MissedExit`: the type vocabulary has none, and a position that
  never closes inside the run is still fully accounted for by the `period_end` close. This is the
  conservative reading of "retried indefinitely" a hygiene-first backtester should default to,
  since discarding an unfilled exit would silently understate risk.
- **A stranded entry retry is finalized at `period.to`, not dropped (Q53; permanent, not a #16
  stopgap).** If the period ends while an entry fill is still being retried (no trade yet, fewer
  than three attempts made), the run records one `MissedEntry` with `reason: "no_trades"` and
  `sessionsTried` equal to the attempts actually made, rather than discarding it silently.
  `evaluateStrategy` is not called on the final session (there is no next session left to fill
  into), so this finalization happens directly in the period-end sweep.

## Consequences

ADR-0004 stays in force with three sharpened points (retry window for missed fills, warn-mode
semantics, walk-forward meaning). ADR-0005 stays in force with the thesis claim as the only source
of `thesis.held`, one explicit counterfactual rule and a thesis-only score when there is no
operation. ADR-0008 stays in force with a single shared expiry per structure and no parameter
space. ADR-0011 stays in force with one amendment: the volatility of an intraday fair-value fill
is the latest index point visible at the fill instant, never the fill session's own close.
ADR-0013 stays in force: Q52 and Q53 are the permanent rules its #16 addendum already implemented,
recorded here rather than as a #16-scope stopgap. The glossary gains "Thesis claim", "Implied
volatility index", "Settlement proposal", "Missed entry", "Leg template", "Evaluation record" and
"Checkpoint", and rewrites "Walk-forward".
