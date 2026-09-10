CREATE TABLE "backtest_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"strategy_id" text NOT NULL,
	"strategy_version_id" text NOT NULL,
	"universe" jsonb NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"initial_capital" bigint NOT NULL,
	"cost_model" jsonb NOT NULL,
	"risk_profile" jsonb NOT NULL,
	"limits" text NOT NULL,
	"sizing" jsonb,
	"seed" integer NOT NULL,
	"config_digest" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"checkpoint" jsonb,
	"result" jsonb,
	"sessions_done" integer,
	"sessions_total" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "backtest_runs_status_check" CHECK ("backtest_runs"."status" in ('pending', 'running', 'paused', 'complete', 'failed')),
	CONSTRAINT "backtest_runs_limits_check" CHECK ("backtest_runs"."limits" in ('enforce', 'warn'))
);
--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backtest_runs_user_id_idx" ON "backtest_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "backtest_runs_strategy_id_idx" ON "backtest_runs" USING btree ("strategy_id");--> statement-breakpoint
-- A run row is written repeatedly while it progresses (a checkpoint after
-- each chunked call) but never again once its status reaches "complete"
-- (CONTEXT.md "Backtest run"). drizzle-kit has no trigger API, so this is
-- hand-appended the same way 0004_empty_skreet.sql enforces
-- strategy_versions' full immutability.
CREATE FUNCTION "backtest_runs_immutable_once_complete"() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'complete' THEN
    RAISE EXCEPTION 'backtest_runs rows are immutable once complete';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "backtest_runs_no_update_once_complete"
BEFORE UPDATE ON "backtest_runs"
FOR EACH ROW EXECUTE FUNCTION "backtest_runs_immutable_once_complete"();