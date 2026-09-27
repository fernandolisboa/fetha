-- #133: `evaluations.reason` grew a web-authored vocabulary alongside the
-- engine's own `EvaluationReason` (#80). Every pre-#80 row still carries
-- `reason IS NULL` and one of the fixed English sentences the engine's
-- `evaluate-strategy.ts` used to write straight into `detail`, or one of
-- the web-authored codes `evaluate-signals.ts` always wrote itself
-- (`unknown_structure`, `market_view_too_large`, `no_market_data`, or the
-- `engine_error:`/`catchup_clamped:`/`unsatisfiable_collection:` prefix
-- codes) — deterministically, since #80 introduced exactly one code per
-- distinct sentence and #133's typed codes replace the same shapes one
-- for one. Data only, no immutability trigger on `evaluations` to work
-- around.
UPDATE "evaluations" SET "reason" = 'no_candles'
WHERE "reason" IS NULL AND "detail" = 'no candles for this instrument and timeframe';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'no_candles_in_catch_up_window'
WHERE "reason" IS NULL
  AND "detail" = 'no candles in (since, at] for this instrument and timeframe';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'entry_condition_warmup'
WHERE "reason" IS NULL AND "detail" = 'entry condition needs more warm-up data';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'no_series_match'
WHERE "reason" IS NULL
  AND "detail" = 'no listed option series satisfies the strike and expiry selection';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'degenerate_strikes'
WHERE "reason" IS NULL
  AND "detail" = 'two distinct strike ranks resolved to the same listed strike';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'no_declared_capital'
WHERE "reason" IS NULL AND "detail" = 'no declared capital to size against';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'unbounded_max_loss'
WHERE "reason" IS NULL
  AND "detail" = 'fixed_risk sizing is unsizeable against an unbounded max loss';--> statement-breakpoint

-- The pre-#59 sentence is deliberately left at reason NULL, unlike every
-- other legacy sentence above: "sizing yields fewer than one unit" covered
-- what #59 later split into two distinct codes, `zero_units` (a unit
-- itself costs or risks nothing) and `unaffordable_budget` (the declared
-- capital and fraction cannot afford one whole unit). Nothing in the
-- stored row disambiguates which of the two actually happened, so mapping
-- it to either would mislabel some rows; a row this old renders the bare
-- outcome label instead, which is honest about not knowing.
UPDATE "evaluations" SET "reason" = 'zero_units'
WHERE "reason" IS NULL AND "detail" = 'a unit carries no cost or risk to size against';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'unaffordable_budget'
WHERE "reason" IS NULL
  AND "detail" = 'the declared capital and fraction cannot afford one unit';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'insufficient_market_data_for_proposal'
WHERE "reason" IS NULL
  AND "detail" = 'not enough market data to select strikes or price the proposal';--> statement-breakpoint

-- Scoped to outcome = 'conditions_not_met' (#80's own shape: a zero-base
-- sentence is written alongside `conditions_not_met` when the rule that
-- hit a zero base did not itself fire). The companion statement just below
-- handles the one other outcome a zero-base sentence could predate #80:
-- see its own comment.
UPDATE "evaluations" SET "reason" = 'profit_target_zero_base'
WHERE "reason" IS NULL AND "outcome" = 'conditions_not_met'
  AND "detail" = 'profit_target cannot fire: the operation''s premium base is zero';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'stop_loss_zero_base'
WHERE "reason" IS NULL AND "outcome" = 'conditions_not_met'
  AND "detail" = 'stop_loss cannot fire: the operation''s max-loss base is zero';--> statement-breakpoint

-- Before #80, a zero-base sentence could also be written alongside
-- `insufficient_data` (an earlier revision of evaluate-strategy.ts did not
-- yet give `instantUnknown` strict precedence over a zero base the same
-- instant also hit). #80's own current logic never emits that combination
-- for a `conditions_not_met`-shaped zero-base reason, and the outcome the
-- engine actually meant by it is what `exit_rule_unknown` names today:
-- "this operation's exit rules could not be evaluated right now", which is
-- what an `insufficient_data` row already says beside a zero-base detail.
UPDATE "evaluations" SET "reason" = 'exit_rule_unknown'
WHERE "reason" IS NULL AND "outcome" = 'insufficient_data'
  AND "detail" IN (
    'profit_target cannot fire: the operation''s premium base is zero',
    'stop_loss cannot fire: the operation''s max-loss base is zero'
  );--> statement-breakpoint

-- The web-authored codes: `unknown_structure`, `market_view_too_large` and
-- `no_market_data` carried no parameter and are rewritten in place; the
-- three prefixed codes are split into their own `reason` plus the bare
-- parameter that used to follow the colon. `starts_with`, not `LIKE`,
-- because `LIKE` treats a bare `_` as a single-character wildcard and
-- every one of these three prefixes contains one.
UPDATE "evaluations" SET "reason" = 'unknown_structure', "detail" = NULL
WHERE "reason" IS NULL AND "detail" = 'unknown_structure';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'market_view_too_large', "detail" = NULL
WHERE "reason" IS NULL AND "detail" = 'market_view_too_large';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'no_market_data', "detail" = NULL
WHERE "reason" IS NULL AND "detail" = 'no_market_data';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'engine_error', "detail" = split_part("detail", ':', 2)
WHERE "reason" IS NULL AND starts_with("detail", 'engine_error:');--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'catchup_clamped', "detail" = split_part("detail", ':', 2)
WHERE "reason" IS NULL AND starts_with("detail", 'catchup_clamped:');--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'unsatisfiable_collection', "detail" = split_part("detail", ':', 2)
WHERE "reason" IS NULL AND starts_with("detail", 'unsatisfiable_collection:');
