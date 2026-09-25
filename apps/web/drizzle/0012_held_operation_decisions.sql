ALTER TABLE "decisions" DROP CONSTRAINT "decisions_origin_kind_check";--> statement-breakpoint
ALTER TABLE "decisions" DROP CONSTRAINT "decisions_origin_match_check";--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "operation_id" text;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_operation_id_user_id_operations_id_user_id_fk" FOREIGN KEY ("operation_id","user_id") REFERENCES "public"."operations"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_user_id_operation_id_idx" ON "decisions" USING btree ("user_id","operation_id");--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_origin_kind_check" CHECK ("decisions"."origin_kind" in ('signal', 'contemplated_operation', 'held_operation'));--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_origin_match_check" CHECK (("decisions"."origin_kind" = 'signal' and "decisions"."signal_id" is not null and "decisions"."contemplated_operation_id" is null and "decisions"."operation_id" is null)
        or ("decisions"."origin_kind" = 'contemplated_operation' and "decisions"."contemplated_operation_id" is not null and "decisions"."signal_id" is null and "decisions"."operation_id" is null)
        or ("decisions"."origin_kind" = 'held_operation' and "decisions"."operation_id" is not null and "decisions"."signal_id" is null and "decisions"."contemplated_operation_id" is null));