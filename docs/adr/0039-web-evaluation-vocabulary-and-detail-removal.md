---
status: accepted
date: 2026-09-27
---

# A typed web-authored evaluation vocabulary; `EvaluationRecord.detail` removed (amends 0013)

## Context

#80 gave the engine's own `evaluate-strategy.ts` a stable `reason: EvaluationReason` code
alongside its old free-English `detail`, so `apps/web` could translate by code instead of matching
an exact sentence. It left one gap open, filed as a follow-up (#133): `evaluate-signals.ts` itself
writes six outcomes the engine never got to evaluate at all — `unknown_structure` (the strategy's
structure was deleted from the catalog after this version was created), `engine_error:<code>` (the
engine returned an error `evaluateStrategy`'s own caller never asked it to model), `catchup_clamped:
<count>` (a catch-up range wider than `CATCH_UP_SESSION_LIMIT` was clamped),
`unsatisfiable_collection:<collection>` (`dataWindow()` asked for a collection `market-data` cannot
fill for this strategy at all), and `market_view_too_large` / `no_market_data` (`loadMarketView`
itself threw: a chain too large to load in one call, or no market data at all for the window — the
same two conditions `backtests/strings.ts`'s `webErrors` already names for a backtest run). All six
went straight into `evaluations.detail` with `reason: NULL`, so `strings.ts` kept an exact-sentence
`detailFor` fallback (matched by prefix for the three variable-suffix codes) permanently alive,
never a one-time migration shim, and every pre-#80 row (`reason IS NULL`, an English `detail`
sentence written before the column existed) rode the same fallback.

Since #80, `EvaluationRecord.detail` is a pure function of `reason` for every record the engine
itself emits: `evaluate-strategy.ts`'s `sizingDetail` map, `zeroBaseMessage` and the fixed strings at
each `record(...)` call site all key off the same `reason` the call already passes. It was kept only
because `apps/web`'s legacy fallback needed an exact-sentence string to match; #80's own addendum
already called it deprecated and slated for removal "once that fallback is no longer needed".

## Decision

1. **A closed web-authored vocabulary, `apps/web/src/modules/strategies/evaluation-vocabulary.ts`.**
   `webEvaluationReasons` (`unknown_structure`, `engine_error`, `catchup_clamped`,
   `unsatisfiable_collection`, `market_view_too_large`, `no_market_data`) is a `WebEvaluationReason`
   union the same shape as the engine's own `EvaluationReason` — a closed code, never a string
   composed with a variable suffix. `evaluate-signals.ts` now writes one of these to `reason` for
   every row it authors itself, and keeps the one piece of variable data each carries (the engine
   error code, the dropped-session count, the collection name) in `detail` alone, unprefixed — never
   re-composed into a single `code:parameter` string. `unknown_structure`, `market_view_too_large`
   and `no_market_data` carry none, so their `detail` is `NULL`. `market_view_too_large` and
   `no_market_data` (`loadMarketView`'s own thrown errors) were left with `reason: NULL` in this
   ticket's first pass, rendered as the bare outcome label; the review that followed treated that as
   the exact pattern this ticket retires — the two comments claiming an invariant the writer broke —
   so both now carry a code of their own too, mirroring the wording
   `apps/web/src/modules/backtests/strings.ts`'s `webErrors` already uses for the same two
   `loadMarketView` failures in a backtest run.

2. **`evaluations.reason`'s read schema is the union of both vocabularies.**
   `signals-repository.ts`'s `evaluationReasonSchema` is now
   `z.enum([...evaluationReasons, ...webEvaluationReasons]).nullable()`, and
   `StoredEvaluationReason = EvaluationReason | WebEvaluationReason`. The engine's own
   `EvaluationReason` is not widened: none of these six codes describe something the engine itself
   ever computes, so they stay a web-side type, never imported into `packages/engine`.

3. **`strings.ts` renders by code, never by string match.** `reasonText` (the #80 exhaustive
   `Record<EvaluationReason, string | null>`) is unchanged. A new `webReasonText`, a
   `Record<WebEvaluationReason, (detail: string | null) => string>`, replaces the old
   `detailFor`/`evaluationDetailEn`/`PtBR`/prefix-matcher machinery entirely: a typed formatter per
   code, fed the row's own `detail` parameter directly, rather than a string match against a
   composed suffix. `evaluationLabel` switches on whether `reason` is `null`, an engine reason or a
   web reason (`isWebEvaluationReason`, a plain array membership check — nothing about the two
   vocabularies overlaps, so this is unambiguous) and renders accordingly. A row with `reason: NULL`
   — every remaining pre-#80 row not covered by the backfill migration below — renders the bare
   outcome label. `detailFor` is deleted.

4. **Pre-#80 rows are backfilled where the mapping is deterministic, `drizzle/0020_backfill_
evaluation_reason.sql`.** Every distinct sentence `evaluationDetailEn` used to match maps to exactly
   one `EvaluationReason` — one code per sentence is exactly what #80 built — except the one wording
   `zero_units` had before #59 (`"sizing yields fewer than one unit"`), which #59 later split into two
   distinct codes, `zero_units` and `unaffordable_budget`; nothing in a stored row disambiguates which
   one an old row meant, so that sentence alone is left at `reason: NULL` rather than guessed at, and
   renders as the bare outcome label. A zero-base sentence (`profit_target`/`stop_loss` "cannot fire")
   is scoped by `outcome = 'conditions_not_met'`, #80's own shape for it; the one other outcome it
   could predate #80 under, `insufficient_data`, gets its own companion statement mapping to
   `exit_rule_unknown`, the name #80's current logic gives that combination. Every web-authored row
   already used one of the same six shapes this ticket now gives a vocabulary (`unknown_structure`,
   `market_view_too_large` and `no_market_data` exactly, or one of the three `code:parameter`
   prefixes matched with `starts_with`, not `LIKE`, since a bare `_` in a prefix like
   `unsatisfiable_collection:` is a `LIKE` wildcard) — so, `zero_units`'s pre-#59 wording aside, the
   mapping is total and deterministic: a plain `UPDATE ... WHERE reason IS NULL AND detail = '...'`
   per sentence, and `split_part(detail, ':', 2)` to lift the parameter out of a prefixed row into
   `detail` alone while `reason` gets the bare code. No immutability trigger sits on `evaluations`
   (unlike `backtest_runs`/`decisions`, ADR-0013's persisted-artifacts addendum), so the migration
   needs no trigger dance. A row this backfill deliberately leaves alone (the pre-#59 wording) or one
   it simply never matches (the migration is conservative: `WHERE reason IS NULL AND detail = <exact
match>`, never a blanket default) renders as the bare outcome label going forward, same as any
   other `reason: NULL` row.

5. **`EvaluationRecord.detail` is removed from the engine's frozen interface (ADR-0013).** The type
   (`packages/engine/src/api.ts`) drops the field; `record(...)` in `evaluate-strategy.ts` drops the
   parameter; every call site is updated. `sizingDetail` and `zeroBaseMessage`, which existed only to
   compute the string this field carried, are deleted outright rather than kept unused.
   `evaluate-signals.ts` now always writes `detail: null` for a row built straight from an
   `EvaluationRecord` (its own web-authored rows keep using `detail` for their own parameter, per
   decision 1) — `detail` stays in the schema as a plain log field (ADR-0013's frozen interface never
   governed a persisted column's own shape, only the engine's `Evaluation` return type), it is simply
   never populated from the engine side anymore.

## `ENGINE_VERSION` is not bumped

ADR-0013's own change-policy addendum states the rule the repo already follows: a bump tracks a
checkpoint- or persistence-breaking shape change, never additivity — or, symmetrically, a removal —
by itself. `EvaluationRecord` is never checkpointed (`BacktestCheckpoint.state` carries backtest
cursor/accumulator state, not evaluation records) and never persisted as a JSON blob the way
`BacktestRun`/`BacktestCheckpoint` are: `evaluate-signals.ts` always destructures an `EvaluationRecord`
field by field into `NewEvaluation`'s own named columns (`ticker`, `session`, `at`, `outcome`,
`reason`), never serializes the record itself into a `jsonb` column. Dropping `detail` therefore
changes nothing a stored row or a resumed checkpoint depends on: there is no existing row whose shape
the engine's own new return type stops matching, unlike #23's `SimulatedOperation.residualSettledBy`
addition, which changed the checkpointed backtest state's own shape mid-flight. `ENGINE_VERSION` stays
`"0.2.0"`.

## Consequences

`strings.test.ts`'s old `evaluationLog.detailFor` describe block is replaced by one exercising
`webReasonText` directly; `evaluate-signals.integration.test.ts`'s assertions on `row.detail` for
`unknown_structure`, `unsatisfiable_collection` and `catchup_clamped` are updated to check `reason`
and the now-unprefixed `detail` instead. The engine's own `evaluate-strategy.test.ts` and
`engine.test.ts` drop every `detail:` expectation; `catch-up-evaluation.json`, the one golden fixture
whose serialized shape included `detail`, is regenerated. `UBIQUITOUS_LANGUAGE.md`'s "Evaluation
record" entry is updated from "with a detail" to "with a reason", matching what actually identifies an
outcome now.
