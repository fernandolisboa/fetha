-- #73: packages/contracts renamed CostModel.brokerage.optionPerContract to
-- optionPerOrder (the charge was always a flat per-order fee, never scaled
-- by contract count; the name was misleading, not the behavior). Every
-- stored CostModel predates the rename and would fail the (strict) schema
-- on read, so the key is rewritten in place, idempotently (only where the
-- old key is still present), everywhere a CostModel is embedded in jsonb:
-- backtest_runs.cost_model and decisions.cost_model directly, and
-- backtest_runs.result at its own config.costModel path. checkpoint (the
-- engine's own opaque, per-session accumulation state, not the immutable
-- config) never carries a CostModel and needs no migration.
UPDATE "backtest_runs"
SET "cost_model" = ("cost_model" - 'brokerage')
  || jsonb_build_object(
    'brokerage',
    ("cost_model"->'brokerage' - 'optionPerContract')
      || jsonb_build_object('optionPerOrder', "cost_model"->'brokerage'->'optionPerContract')
  )
WHERE "cost_model"->'brokerage' ? 'optionPerContract';--> statement-breakpoint

UPDATE "decisions"
SET "cost_model" = ("cost_model" - 'brokerage')
  || jsonb_build_object(
    'brokerage',
    ("cost_model"->'brokerage' - 'optionPerContract')
      || jsonb_build_object('optionPerOrder', "cost_model"->'brokerage'->'optionPerContract')
  )
WHERE "cost_model"->'brokerage' ? 'optionPerContract';--> statement-breakpoint

UPDATE "backtest_runs"
SET "result" = jsonb_set(
  "result",
  '{config,costModel,brokerage}',
  ("result"->'config'->'costModel'->'brokerage' - 'optionPerContract')
    || jsonb_build_object(
      'optionPerOrder',
      "result"->'config'->'costModel'->'brokerage'->'optionPerContract'
    )
)
WHERE "result" IS NOT NULL
  AND "result"->'config'->'costModel'->'brokerage' ? 'optionPerContract';
