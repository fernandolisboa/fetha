CREATE TABLE "operation_plan_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"contemplated_operation_id" text NOT NULL,
	"recipe_id" text NOT NULL,
	"rules" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operation_plan_rules" ADD CONSTRAINT "operation_plan_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_plan_rules" ADD CONSTRAINT "operation_plan_rules_contemplated_operation_id_user_id_contemplated_operations_id_user_id_fk" FOREIGN KEY ("contemplated_operation_id","user_id") REFERENCES "public"."contemplated_operations"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operation_plan_rules_user_id_created_at_idx" ON "operation_plan_rules" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "operation_plan_rules_contemplated_operation_id_idx" ON "operation_plan_rules" USING btree ("contemplated_operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contemplated_operations_id_user_id_idx" ON "contemplated_operations" USING btree ("id","user_id");