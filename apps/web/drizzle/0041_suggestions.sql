CREATE TABLE "suggestion_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"suggestion_id" text NOT NULL,
	"score" jsonb,
	"unscorable_reason" text,
	"claim_held" boolean,
	"pnl_centavos" bigint,
	"max_loss_centavos" bigint,
	"normalized_pnl" numeric,
	"engine_version" text NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suggestion_scores_score_xor_unscorable_check" CHECK (("suggestion_scores"."score" is not null and "suggestion_scores"."unscorable_reason" is null)
        or ("suggestion_scores"."score" is null and "suggestion_scores"."unscorable_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"underlying" text NOT NULL,
	"session" date NOT NULL,
	"recipe_id" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"legs" jsonb NOT NULL,
	"pricing" jsonb NOT NULL,
	"claim" jsonb NOT NULL,
	"horizon" date NOT NULL,
	CONSTRAINT "suggestions_horizon_after_session_check" CHECK ("suggestions"."horizon" > "suggestions"."session")
);
--> statement-breakpoint
ALTER TABLE "analysis_requests" DROP CONSTRAINT "analysis_requests_subject_kind_check";--> statement-breakpoint
ALTER TABLE "decisions" DROP CONSTRAINT "decisions_origin_kind_check";--> statement-breakpoint
ALTER TABLE "decisions" DROP CONSTRAINT "decisions_origin_match_check";--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "suggestion_id" text;--> statement-breakpoint
ALTER TABLE "suggestion_scores" ADD CONSTRAINT "suggestion_scores_suggestion_id_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_underlying_session_recipe_id_radar_matches_underlying_session_recipe_id_fk" FOREIGN KEY ("underlying","session","recipe_id") REFERENCES "public"."radar_matches"("underlying","session","recipe_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "suggestion_scores_suggestion_id_idx" ON "suggestion_scores" USING btree ("suggestion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suggestions_underlying_session_recipe_id_idx" ON "suggestions" USING btree ("underlying","session","recipe_id");--> statement-breakpoint
CREATE INDEX "suggestions_session_idx" ON "suggestions" USING btree ("session");--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_suggestion_id_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_user_id_suggestion_id_idx" ON "decisions" USING btree ("user_id","suggestion_id") WHERE "decisions"."suggestion_id" is not null;--> statement-breakpoint
ALTER TABLE "analysis_requests" ADD CONSTRAINT "analysis_requests_subject_kind_check" CHECK ("analysis_requests"."subject_kind" in ('signal', 'contemplated_operation', 'held_operation', 'backtest_run', 'suggestion'));--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_origin_kind_check" CHECK ("decisions"."origin_kind" in ('signal', 'contemplated_operation', 'held_operation', 'suggestion'));--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_origin_match_check" CHECK (("decisions"."origin_kind" = 'signal' and "decisions"."signal_id" is not null and "decisions"."contemplated_operation_id" is null and "decisions"."operation_id" is null and "decisions"."suggestion_id" is null)
        or ("decisions"."origin_kind" = 'contemplated_operation' and "decisions"."contemplated_operation_id" is not null and "decisions"."signal_id" is null and "decisions"."operation_id" is null and "decisions"."suggestion_id" is null)
        or ("decisions"."origin_kind" = 'held_operation' and "decisions"."operation_id" is not null and "decisions"."signal_id" is null and "decisions"."contemplated_operation_id" is null and "decisions"."suggestion_id" is null)
        or ("decisions"."origin_kind" = 'suggestion' and "decisions"."suggestion_id" is not null and "decisions"."signal_id" is null and "decisions"."contemplated_operation_id" is null and "decisions"."operation_id" is null));--> statement-breakpoint
-- A suggestion's score is append-only like a decision's (docs/adr/0067): the nightly step only
-- inserts, and this trigger makes that a database invariant. DELETE stays allowed so a suggestion
-- removed with its radar match takes its score with it.
CREATE FUNCTION "suggestion_scores_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'suggestion_scores rows are immutable and cannot be updated';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "suggestion_scores_no_update"
BEFORE UPDATE ON "suggestion_scores"
FOR EACH ROW EXECUTE FUNCTION "suggestion_scores_immutable"();
