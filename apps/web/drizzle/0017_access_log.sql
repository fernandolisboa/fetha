CREATE TABLE "access_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	CONSTRAINT "access_log_event_check" CHECK ("access_log"."event" in ('portfolio_read', 'decisions_read', 'data_export'))
);
--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_log_user_id_occurred_at_idx" ON "access_log" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "access_log_occurred_at_idx" ON "access_log" USING btree ("occurred_at");