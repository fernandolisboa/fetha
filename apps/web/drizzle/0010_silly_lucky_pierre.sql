CREATE TABLE "decision_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"decision_id" text NOT NULL,
	"score" jsonb NOT NULL,
	"pnl_centavos" bigint,
	"max_loss_centavos" bigint,
	"max_loss_unbounded" boolean DEFAULT false NOT NULL,
	"normalized_pnl" numeric,
	"claim_held" boolean,
	"brier" numeric,
	"counterfactual_pnl_centavos" bigint,
	"engine_version" text NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decision_scores" ADD CONSTRAINT "decision_scores_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_scores" ADD CONSTRAINT "decision_scores_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_scores_decision_id_idx" ON "decision_scores" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "decision_scores_user_id_scored_at_idx" ON "decision_scores" USING btree ("user_id","scored_at");--> statement-breakpoint
-- Scores are append-only (docs/adr/0005 as amended by ADR-0014, brief item
-- 1): the repository exposes only `insertIfAbsent` and read methods, but
-- that is application discipline, not a guarantee. This trigger makes it a
-- database invariant the same way 0009_green_white_queen.sql does for
-- decisions. DELETE stays allowed so a user's account deletion can still
-- remove their own rows via the user_id cascade.
CREATE FUNCTION "decision_scores_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'decision_scores rows are immutable and cannot be updated';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "decision_scores_no_update"
BEFORE UPDATE ON "decision_scores"
FOR EACH ROW EXECUTE FUNCTION "decision_scores_immutable"();