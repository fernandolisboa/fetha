CREATE TABLE "strategies" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"copied_from_strategy_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"config_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "structures" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"legs" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "strategies_user_id_idx" ON "strategies" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_versions_strategy_id_version_number_idx" ON "strategy_versions" USING btree ("strategy_id","version_number");--> statement-breakpoint
CREATE INDEX "strategy_versions_strategy_id_idx" ON "strategy_versions" USING btree ("strategy_id");--> statement-breakpoint
-- The trivial structure named by UBIQUITOUS_LANGUAGE.md ("a single stock
-- purchase is the trivial structure with one stock leg"): needed for the
-- strategy editor to have at least one selectable structure before #20
-- seeds the hand-written reference structures (collar, trava de alta,
-- butterfly, condor) and reference strategies.
INSERT INTO "structures" ("id", "name", "legs") VALUES ('stock', 'Compra de ação', '[{"role":"stock","side":"buy","ratio":1}]') ON CONFLICT ("id") DO NOTHING;