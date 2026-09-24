CREATE TABLE "decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"origin_kind" text NOT NULL,
	"signal_id" text,
	"contemplated_operation_id" text,
	"strategy_version_id" text,
	"inputs" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"claim" jsonb,
	"confidence" numeric NOT NULL,
	"horizon" date NOT NULL,
	"cost_model" jsonb NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_kind_check" CHECK ("decisions"."kind" in ('enter', 'do_not_enter', 'hold', 'adjust', 'exit')),
	CONSTRAINT "decisions_origin_kind_check" CHECK ("decisions"."origin_kind" in ('signal', 'contemplated_operation')),
	CONSTRAINT "decisions_origin_match_check" CHECK (("decisions"."origin_kind" = 'signal' and "decisions"."signal_id" is not null and "decisions"."contemplated_operation_id" is null)
        or ("decisions"."origin_kind" = 'contemplated_operation' and "decisions"."contemplated_operation_id" is not null and "decisions"."signal_id" is null)),
	CONSTRAINT "decisions_rationale_not_blank_check" CHECK (length(trim("decisions"."rationale")) > 0),
	CONSTRAINT "decisions_confidence_range_check" CHECK ("decisions"."confidence" >= 0 and "decisions"."confidence" <= 1),
	CONSTRAINT "decisions_horizon_on_or_after_decided_check" CHECK ("decisions"."horizon" >= (("decisions"."decided_at" at time zone 'America/Sao_Paulo')::date))
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_contemplated_operation_id_contemplated_operations_id_fk" FOREIGN KEY ("contemplated_operation_id") REFERENCES "public"."contemplated_operations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_user_id_decided_at_idx" ON "decisions" USING btree ("user_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_user_id_signal_id_idx" ON "decisions" USING btree ("user_id","signal_id") WHERE "decisions"."signal_id" is not null;--> statement-breakpoint
-- Decisions are append-only (docs/adr/0005, UBIQUITOUS_LANGUAGE.md
-- "Decision"/"Journal"): the repository exposes only `record` and read
-- methods, but that is application discipline, not a guarantee. This
-- trigger makes it a database invariant the same way
-- 0004_empty_skreet.sql does for strategy_versions: any UPDATE, from any
-- code path, is refused. DELETE stays allowed so a user's account deletion
-- can still remove their own rows via the user_id cascade.
CREATE FUNCTION "decisions_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'decisions rows are immutable and cannot be updated';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "decisions_no_update"
BEFORE UPDATE ON "decisions"
FOR EACH ROW EXECUTE FUNCTION "decisions_immutable"();