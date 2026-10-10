CREATE TABLE "analysis_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_requests_subject_kind_check" CHECK ("analysis_requests"."subject_kind" in ('signal', 'contemplated_operation', 'held_operation', 'backtest_run'))
);
--> statement-breakpoint
CREATE TABLE "analysis_results" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"outcome" text NOT NULL,
	"output" jsonb,
	"reason" jsonb,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_results_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "analysis_results_outcome_check" CHECK ("analysis_results"."outcome" in ('accepted', 'rejected', 'failed')),
	CONSTRAINT "analysis_results_output_xor_reason_check" CHECK (("analysis_results"."outcome" = 'accepted' and "analysis_results"."output" is not null and "analysis_results"."reason" is null)
        or ("analysis_results"."outcome" <> 'accepted' and "analysis_results"."output" is null and "analysis_results"."reason" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_requests_id_user_id_idx" ON "analysis_requests" USING btree ("id","user_id");--> statement-breakpoint
ALTER TABLE "analysis_requests" ADD CONSTRAINT "analysis_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_request_id_user_id_fk" FOREIGN KEY ("request_id","user_id") REFERENCES "public"."analysis_requests"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_requests_user_id_requested_at_idx" ON "analysis_requests" USING btree ("user_id","requested_at");--> statement-breakpoint
CREATE INDEX "analysis_requests_user_id_subject_idx" ON "analysis_requests" USING btree ("user_id","subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "analysis_results_user_id_completed_at_idx" ON "analysis_results" USING btree ("user_id","completed_at");--> statement-breakpoint
-- Analysis requests and results are append-only (docs/adr/0057): the
-- repository exposes only `reserve`/`complete` and read methods, but that is
-- application discipline, not a guarantee. These triggers make it a
-- database invariant the same way 0009_green_white_queen.sql does for
-- `decisions`. DELETE stays allowed so a user's account deletion can still
-- remove their own rows via the `user_id` cascade.
CREATE FUNCTION "analysis_requests_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'analysis_requests rows are immutable and cannot be updated';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "analysis_requests_no_update"
BEFORE UPDATE ON "analysis_requests"
FOR EACH ROW EXECUTE FUNCTION "analysis_requests_immutable"();--> statement-breakpoint
CREATE FUNCTION "analysis_results_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'analysis_results rows are immutable and cannot be updated';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "analysis_results_no_update"
BEFORE UPDATE ON "analysis_results"
FOR EACH ROW EXECUTE FUNCTION "analysis_results_immutable"();