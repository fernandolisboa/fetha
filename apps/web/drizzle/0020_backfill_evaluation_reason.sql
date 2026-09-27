-- #133: `evaluations.reason` grew a web-authored vocabulary alongside the
-- engine's own `EvaluationReason` (#80). Every pre-#80 row still carries
-- `reason IS NULL` and one of the fixed English sentences the engine's
-- `evaluate-strategy.ts` used to write straight into `detail`, or one of
-- the web-authored codes `evaluate-signals.ts` always wrote itself
-- (`unknown_structure`, or the `engine_error:`/`catchup_clamped:`/
-- `unsatisfiable_collection:` prefix codes) — deterministically, since #80
-- introduced exactly one code per distinct sentence and #133's four
-- web-authored codes replace the same four prefixes one for one. Data
-- only, no immutability trigger on `evaluations` to work around.
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

-- Two wordings for the same code: the pre-#59 sentence and the one that replaced it.
UPDATE "evaluations" SET "reason" = 'zero_units'
WHERE "reason" IS NULL AND "detail" = 'sizing yields fewer than one unit';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'zero_units'
WHERE "reason" IS NULL AND "detail" = 'a unit carries no cost or risk to size against';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'unaffordable_budget'
WHERE "reason" IS NULL
  AND "detail" = 'the declared capital and fraction cannot afford one unit';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'insufficient_market_data_for_proposal'
WHERE "reason" IS NULL
  AND "detail" = 'not enough market data to select strikes or price the proposal';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'profit_target_zero_base'
WHERE "reason" IS NULL
  AND "detail" = 'profit_target cannot fire: the operation''s premium base is zero';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'stop_loss_zero_base'
WHERE "reason" IS NULL
  AND "detail" = 'stop_loss cannot fire: the operation''s max-loss base is zero';--> statement-breakpoint

-- The web-authored codes: `unknown_structure` carried no parameter and is
-- rewritten in place; the three prefixed codes are split into their own
-- `reason` plus the bare parameter that used to follow the colon.
UPDATE "evaluations" SET "reason" = 'unknown_structure', "detail" = NULL
WHERE "reason" IS NULL AND "detail" = 'unknown_structure';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'engine_error', "detail" = split_part("detail", ':', 2)
WHERE "reason" IS NULL AND "detail" LIKE 'engine_error:%';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'catchup_clamped', "detail" = split_part("detail", ':', 2)
WHERE "reason" IS NULL AND "detail" LIKE 'catchup_clamped:%';--> statement-breakpoint

UPDATE "evaluations" SET "reason" = 'unsatisfiable_collection', "detail" = split_part("detail", ':', 2)
WHERE "reason" IS NULL AND "detail" LIKE 'unsatisfiable_collection:%';
