-- #73: packages/contracts renamed CostModel.brokerage.optionPerContract to
-- optionPerOrder (the charge was always a flat per-order fee, never scaled
-- by contract count; the name was misleading, not the behavior). Every
-- stored CostModel predates the rename and would fail the (strict) schema
-- on read, so the key is rewritten in place, idempotently (only where the
-- old key is still present). checkpoint (the engine's own opaque,
-- per-session accumulation state, not the immutable config) never carries
-- a CostModel and needs no migration. Both tables forbid UPDATE through
-- their immutability triggers (0008, 0009); the rename is the one write
-- those triggers were never meant to block, so they are disabled for this
-- transaction only and re-enabled before it commits.
ALTER TABLE "backtest_runs" DISABLE TRIGGER "backtest_runs_no_update_once_complete";--> statement-breakpoint
ALTER TABLE "decisions" DISABLE TRIGGER "decisions_no_update";--> statement-breakpoint
UPDATE "backtest_runs"
SET "cost_model" = ("cost_model" - 'brokerage')
  || jsonb_build_object(
    'brokerage',
    (("cost_model"->'brokerage') - 'optionPerContract')
      || jsonb_build_object('optionPerOrder', "cost_model"->'brokerage'->'optionPerContract')
  )
WHERE "cost_model"->'brokerage' ? 'optionPerContract';--> statement-breakpoint

UPDATE "decisions"
SET "cost_model" = ("cost_model" - 'brokerage')
  || jsonb_build_object(
    'brokerage',
    (("cost_model"->'brokerage') - 'optionPerContract')
      || jsonb_build_object('optionPerOrder', "cost_model"->'brokerage'->'optionPerContract')
  )
WHERE "cost_model"->'brokerage' ? 'optionPerContract';--> statement-breakpoint

UPDATE "backtest_runs"
SET "result" = jsonb_set(
  "result",
  '{config,costModel,brokerage}',
  (("result"->'config'->'costModel'->'brokerage') - 'optionPerContract')
    || jsonb_build_object(
      'optionPerOrder',
      "result"->'config'->'costModel'->'brokerage'->'optionPerContract'
    )
)
WHERE "result" IS NOT NULL
  AND "result"->'config'->'costModel'->'brokerage' ? 'optionPerContract';--> statement-breakpoint
ALTER TABLE "backtest_runs" ENABLE TRIGGER "backtest_runs_no_update_once_complete";--> statement-breakpoint
ALTER TABLE "decisions" ENABLE TRIGGER "decisions_no_update";
