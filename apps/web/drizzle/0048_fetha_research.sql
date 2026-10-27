CREATE TABLE "research_idea_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"idea_id" text NOT NULL,
	"score" jsonb,
	"unscorable_reason" text,
	"claim_held" boolean,
	"pnl_centavos" bigint,
	"max_loss_centavos" bigint,
	"normalized_pnl" numeric,
	"engine_version" text NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_idea_scores_score_xor_unscorable_check" CHECK (("research_idea_scores"."score" is not null and "research_idea_scores"."unscorable_reason" is null)
        or ("research_idea_scores"."score" is null and "research_idea_scores"."unscorable_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "research_ideas" (
	"id" text PRIMARY KEY NOT NULL,
	"research_id" text NOT NULL,
	"user_id" text NOT NULL,
	"position" integer NOT NULL,
	"underlying" text NOT NULL,
	"recipe_id" text NOT NULL,
	"found_on" date NOT NULL,
	"suggestion_id" text,
	"newest_close" date NOT NULL,
	"sessions_to_expiry" integer NOT NULL,
	"legs" jsonb NOT NULL,
	"pricing" jsonb NOT NULL,
	"reading" jsonb NOT NULL,
	"engine_alerts" jsonb NOT NULL,
	"verdict" text NOT NULL,
	"justification" text NOT NULL,
	"ai_alerts" jsonb NOT NULL,
	"inputs_cited" jsonb NOT NULL,
	"claim" jsonb NOT NULL,
	"horizon" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_ideas_position_check" CHECK ("research_ideas"."position" >= 0),
	CONSTRAINT "research_ideas_verdict_check" CHECK ("research_ideas"."verdict" in ('enter', 'wait', 'do_not_enter')),
	CONSTRAINT "research_ideas_horizon_after_close_check" CHECK ("research_ideas"."horizon" > "research_ideas"."newest_close")
);
--> statement-breakpoint
CREATE TABLE "suggestion_researches" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"analysis_request_id" text NOT NULL,
	"newest_close" date NOT NULL,
	"sessions_looked" integer NOT NULL,
	"candidates" integer NOT NULL,
	"dropped" jsonb NOT NULL,
	"using_default_profile" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suggestion_researches_counts_check" CHECK ("suggestion_researches"."sessions_looked" >= 0 and "suggestion_researches"."candidates" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "research_ideas_id_user_id_idx" ON "research_ideas" USING btree ("id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suggestion_researches_id_user_id_idx" ON "suggestion_researches" USING btree ("id","user_id");--> statement-breakpoint
ALTER TABLE "analysis_requests" DROP CONSTRAINT "analysis_requests_subject_kind_check";--> statement-breakpoint
ALTER TABLE "decisions" DROP CONSTRAINT "decisions_origin_kind_check";--> statement-breakpoint
ALTER TABLE "decisions" DROP CONSTRAINT "decisions_origin_match_check";--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "research_idea_id" text;--> statement-breakpoint
ALTER TABLE "research_idea_scores" ADD CONSTRAINT "research_idea_scores_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_idea_scores" ADD CONSTRAINT "research_idea_scores_idea_id_user_id_fk" FOREIGN KEY ("idea_id","user_id") REFERENCES "public"."research_ideas"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_ideas" ADD CONSTRAINT "research_ideas_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_ideas" ADD CONSTRAINT "research_ideas_suggestion_id_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_ideas" ADD CONSTRAINT "research_ideas_research_id_user_id_fk" FOREIGN KEY ("research_id","user_id") REFERENCES "public"."suggestion_researches"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_researches" ADD CONSTRAINT "suggestion_researches_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_researches" ADD CONSTRAINT "suggestion_researches_request_id_user_id_fk" FOREIGN KEY ("analysis_request_id","user_id") REFERENCES "public"."analysis_requests"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_idea_scores_idea_id_idx" ON "research_idea_scores" USING btree ("idea_id");--> statement-breakpoint
CREATE INDEX "research_idea_scores_user_id_scored_at_idx" ON "research_idea_scores" USING btree ("user_id","scored_at");--> statement-breakpoint
CREATE UNIQUE INDEX "research_ideas_research_id_position_idx" ON "research_ideas" USING btree ("research_id","position");--> statement-breakpoint
CREATE INDEX "research_ideas_user_id_horizon_idx" ON "research_ideas" USING btree ("user_id","horizon");--> statement-breakpoint
CREATE INDEX "suggestion_researches_user_id_created_at_idx" ON "suggestion_researches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "suggestion_researches_analysis_request_id_idx" ON "suggestion_researches" USING btree ("analysis_request_id");--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_research_idea_id_user_id_fk" FOREIGN KEY ("research_idea_id","user_id") REFERENCES "public"."research_ideas"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decisions_user_id_research_idea_id_idx" ON "decisions" USING btree ("user_id","research_idea_id") WHERE "decisions"."research_idea_id" is not null;--> statement-breakpoint
ALTER TABLE "analysis_requests" ADD CONSTRAINT "analysis_requests_subject_kind_check" CHECK ("analysis_requests"."subject_kind" in ('signal', 'contemplated_operation', 'held_operation', 'backtest_run', 'suggestion', 'research'));--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_origin_kind_check" CHECK ("decisions"."origin_kind" in ('signal', 'contemplated_operation', 'held_operation', 'suggestion', 'research_idea'));--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_origin_match_check" CHECK (("decisions"."origin_kind" = 'signal' and "decisions"."signal_id" is not null and "decisions"."contemplated_operation_id" is null and "decisions"."operation_id" is null and "decisions"."suggestion_id" is null and "decisions"."research_idea_id" is null)
        or ("decisions"."origin_kind" = 'contemplated_operation' and "decisions"."contemplated_operation_id" is not null and "decisions"."signal_id" is null and "decisions"."operation_id" is null and "decisions"."suggestion_id" is null and "decisions"."research_idea_id" is null)
        or ("decisions"."origin_kind" = 'held_operation' and "decisions"."operation_id" is not null and "decisions"."signal_id" is null and "decisions"."contemplated_operation_id" is null and "decisions"."suggestion_id" is null and "decisions"."research_idea_id" is null)
        or ("decisions"."origin_kind" = 'suggestion' and "decisions"."suggestion_id" is not null and "decisions"."signal_id" is null and "decisions"."contemplated_operation_id" is null and "decisions"."operation_id" is null and "decisions"."research_idea_id" is null)
        or ("decisions"."origin_kind" = 'research_idea' and "decisions"."research_idea_id" is not null and "decisions"."signal_id" is null and "decisions"."contemplated_operation_id" is null and "decisions"."operation_id" is null and "decisions"."suggestion_id" is null));--> statement-breakpoint
-- A research, its ideas and their scores are append-only like a suggestion's score (docs/adr/0076):
-- the application only inserts, and these triggers make that a database invariant. DELETE stays
-- allowed so the account-deletion cascade removes them with the user.
CREATE FUNCTION "research_rows_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable and cannot be updated', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "suggestion_researches_no_update"
BEFORE UPDATE ON "suggestion_researches"
FOR EACH ROW EXECUTE FUNCTION "research_rows_immutable"();--> statement-breakpoint
CREATE TRIGGER "research_ideas_no_update"
BEFORE UPDATE ON "research_ideas"
FOR EACH ROW EXECUTE FUNCTION "research_rows_immutable"();--> statement-breakpoint
CREATE TRIGGER "research_idea_scores_no_update"
BEFORE UPDATE ON "research_idea_scores"
FOR EACH ROW EXECUTE FUNCTION "research_rows_immutable"();
