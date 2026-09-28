CREATE TABLE "nightly_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"ok" boolean NOT NULL,
	"report" jsonb NOT NULL,
	CONSTRAINT "nightly_runs_trigger_check" CHECK ("nightly_runs"."trigger" in ('cron', 'manual'))
);
--> statement-breakpoint
CREATE INDEX "nightly_runs_started_at_idx" ON "nightly_runs" USING btree ("started_at");--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nightly_report_reader') THEN
    CREATE ROLE nightly_report_reader NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO nightly_report_reader;--> statement-breakpoint
GRANT SELECT ON "nightly_runs" TO nightly_report_reader;