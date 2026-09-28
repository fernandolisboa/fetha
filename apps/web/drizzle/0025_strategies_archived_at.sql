ALTER TABLE "strategies" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "strategies_archived_at_idx" ON "strategies" USING btree ("archived_at");