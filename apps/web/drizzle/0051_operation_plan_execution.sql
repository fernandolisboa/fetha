CREATE TABLE "plan_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"operation_plan_rules_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"kind" text NOT NULL,
	"session" date NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_signals_kind_check" CHECK ("plan_signals"."kind" in ('target_hit', 'stop_hit', 'roll_due'))
);
--> statement-breakpoint
ALTER TABLE "operation_plan_rules" ADD COLUMN "operation_id" text;--> statement-breakpoint
ALTER TABLE "plan_signals" ADD CONSTRAINT "plan_signals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_signals" ADD CONSTRAINT "plan_signals_operation_plan_rules_id_user_id_operation_plan_rules_id_user_id_fk" FOREIGN KEY ("operation_plan_rules_id","user_id") REFERENCES "public"."operation_plan_rules"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_signals" ADD CONSTRAINT "plan_signals_operation_id_user_id_operations_id_user_id_fk" FOREIGN KEY ("operation_id","user_id") REFERENCES "public"."operations"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_signals_user_operation_kind_idx" ON "plan_signals" USING btree ("user_id","operation_id","kind");--> statement-breakpoint
CREATE INDEX "plan_signals_user_id_created_at_idx" ON "plan_signals" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "operation_plan_rules" ADD CONSTRAINT "operation_plan_rules_operation_id_user_id_operations_id_user_id_fk" FOREIGN KEY ("operation_id","user_id") REFERENCES "public"."operations"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operation_plan_rules_operation_id_idx" ON "operation_plan_rules" USING btree ("operation_id");