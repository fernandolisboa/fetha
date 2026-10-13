CREATE TABLE "analysis_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"score" jsonb,
	"unscorable_reason" text,
	"claim_held" boolean,
	"brier" numeric,
	"engine_version" text NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_scores_score_xor_unscorable_check" CHECK (("analysis_scores"."score" is not null and "analysis_scores"."unscorable_reason" is null)
        or ("analysis_scores"."score" is null and "analysis_scores"."unscorable_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "analysis_results" ADD COLUMN "claim" jsonb;--> statement-breakpoint
ALTER TABLE "analysis_results" ADD COLUMN "claim_confidence" numeric;--> statement-breakpoint
ALTER TABLE "analysis_results" ADD COLUMN "horizon" date;--> statement-breakpoint
ALTER TABLE "analysis_scores" ADD CONSTRAINT "analysis_scores_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_scores" ADD CONSTRAINT "analysis_scores_request_id_user_id_fk" FOREIGN KEY ("request_id","user_id") REFERENCES "public"."analysis_requests"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_scores_request_id_idx" ON "analysis_scores" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "analysis_scores_user_id_scored_at_idx" ON "analysis_scores" USING btree ("user_id","scored_at");--> statement-breakpoint
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_claim_all_or_none_check" CHECK (("analysis_results"."claim" is null and "analysis_results"."claim_confidence" is null and "analysis_results"."horizon" is null)
        or ("analysis_results"."outcome" = 'accepted' and "analysis_results"."claim" is not null
          and "analysis_results"."claim_confidence" is not null and "analysis_results"."horizon" is not null));--> statement-breakpoint
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_claim_confidence_range_check" CHECK ("analysis_results"."claim_confidence" >= 0 and "analysis_results"."claim_confidence" <= 1);--> statement-breakpoint
-- Analysis scores are append-only (docs/adr/0058), the same database
-- invariant 0034_analyses.sql gives analysis requests and results. DELETE
-- stays allowed so a user's account deletion can still remove their own rows
-- via the `user_id` cascade.
CREATE FUNCTION "analysis_scores_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'analysis_scores rows are immutable and cannot be updated';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "analysis_scores_no_update"
BEFORE UPDATE ON "analysis_scores"
FOR EACH ROW EXECUTE FUNCTION "analysis_scores_immutable"();
