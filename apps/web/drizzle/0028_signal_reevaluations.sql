CREATE TABLE "signal_reevaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"strategy_id" text NOT NULL,
	"session" text NOT NULL,
	"status" text NOT NULL,
	"failure_reason" text,
	"evaluations_superseded" integer DEFAULT 0 NOT NULL,
	"signals_retracted" integer DEFAULT 0 NOT NULL,
	"signals_replaced" integer DEFAULT 0 NOT NULL,
	"signals_added" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_reevaluations_status_check" CHECK ("signal_reevaluations"."status" in ('applied', 'unchanged', 'failed'))
);
--> statement-breakpoint
DROP INDEX "evaluations_user_version_ticker_session_idx";--> statement-breakpoint
DROP INDEX "signals_user_version_ticker_session_kind_operation_idx";--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "reevaluation_id" text;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "superseded_by" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "reevaluation_id" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "superseded_by" text;--> statement-breakpoint
ALTER TABLE "signal_reevaluations" ADD CONSTRAINT "signal_reevaluations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_reevaluations" ADD CONSTRAINT "signal_reevaluations_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signal_reevaluations_user_id_created_at_idx" ON "signal_reevaluations" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_reevaluation_id_signal_reevaluations_id_fk" FOREIGN KEY ("reevaluation_id") REFERENCES "public"."signal_reevaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_superseded_by_signal_reevaluations_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."signal_reevaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_reevaluation_id_signal_reevaluations_id_fk" FOREIGN KEY ("reevaluation_id") REFERENCES "public"."signal_reevaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_superseded_by_signal_reevaluations_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."signal_reevaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evaluations_user_version_ticker_session_idx" ON "evaluations" USING btree ("user_id","strategy_version_id","ticker","session") WHERE "evaluations"."superseded_by" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "signals_user_version_ticker_session_kind_operation_idx" ON "signals" USING btree ("user_id","strategy_version_id","ticker","session","kind","operation_id") WHERE "signals"."superseded_by" is null;--> statement-breakpoint
-- Signals and evaluations are append-only (docs/adr/0046, #84): a
-- re-evaluation supersedes a row by stamping `superseded_by` once and writing
-- a new row, never by rewriting or deleting the old one. drizzle-kit has no
-- trigger API, so this is hand-appended like `decisions_no_update` (0009).
-- `read_at` stays writable on signals (marking a signal read); DELETE stays
-- allowed so account deletion still cascades.
CREATE FUNCTION "evaluations_append_only"() RETURNS trigger AS $$
BEGIN
  IF OLD.superseded_by IS NOT NULL
    OR NEW.superseded_by IS NULL
    OR (to_jsonb(NEW) - 'superseded_by') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_by') THEN
    RAISE EXCEPTION 'evaluations rows are append-only: only superseded_by may be set, once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "evaluations_append_only"
BEFORE UPDATE ON "evaluations"
FOR EACH ROW EXECUTE FUNCTION "evaluations_append_only"();--> statement-breakpoint
CREATE FUNCTION "signals_append_only"() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'superseded_by' - 'read_at') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_by' - 'read_at')
    OR (OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS DISTINCT FROM OLD.superseded_by) THEN
    RAISE EXCEPTION 'signals rows are append-only: only read_at may change and superseded_by may be set once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "signals_append_only"
BEFORE UPDATE ON "signals"
FOR EACH ROW EXECUTE FUNCTION "signals_append_only"();
