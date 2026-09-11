CREATE TABLE "evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"strategy_id" text NOT NULL,
	"strategy_version_id" text NOT NULL,
	"ticker" text NOT NULL,
	"session" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"outcome" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"strategy_id" text NOT NULL,
	"strategy_version_id" text NOT NULL,
	"ticker" text NOT NULL,
	"timeframe" text NOT NULL,
	"session" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"indicators" jsonb NOT NULL,
	"proposal" jsonb,
	"operation_id" text DEFAULT '' NOT NULL,
	"rule" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signals_kind_check" CHECK ("signals"."kind" in ('entry', 'exit', 'adjust'))
);
--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_strategy_version_id_strategy_versions_id_fk" FOREIGN KEY ("strategy_version_id") REFERENCES "public"."strategy_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evaluations_user_version_ticker_session_idx" ON "evaluations" USING btree ("user_id","strategy_version_id","ticker","session");--> statement-breakpoint
CREATE INDEX "evaluations_user_id_strategy_id_idx" ON "evaluations" USING btree ("user_id","strategy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signals_user_version_ticker_session_kind_operation_idx" ON "signals" USING btree ("user_id","strategy_version_id","ticker","session","kind","operation_id");--> statement-breakpoint
CREATE INDEX "signals_user_id_read_at_idx" ON "signals" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "strategies_active_idx" ON "strategies" USING btree ("active");