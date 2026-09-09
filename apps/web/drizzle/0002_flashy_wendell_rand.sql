CREATE TABLE "strategies" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"copied_from_strategy_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategies_visibility_check" CHECK ("strategies"."visibility" in ('private', 'shared'))
);
--> statement-breakpoint
CREATE TABLE "strategy_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"strategy_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"definition_digest" text NOT NULL,
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
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_copied_from_strategy_id_strategies_id_fk" FOREIGN KEY ("copied_from_strategy_id") REFERENCES "public"."strategies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "strategies_user_id_idx" ON "strategies" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_versions_strategy_id_version_number_idx" ON "strategy_versions" USING btree ("strategy_id","version_number");--> statement-breakpoint
CREATE INDEX "strategy_versions_strategy_id_idx" ON "strategy_versions" USING btree ("strategy_id");--> statement-breakpoint
-- Strategy versions are immutable once inserted (docs/adr/0008,
-- UBIQUITOUS_LANGUAGE.md "Strategy version"): the repository exposes no
-- update method for this table, only inserts, but that is application
-- discipline, not a guarantee. This trigger makes it a database invariant:
-- any UPDATE, from any code path, is refused.
CREATE FUNCTION "strategy_versions_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'strategy_versions rows are immutable and cannot be updated';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "strategy_versions_no_update"
BEFORE UPDATE ON "strategy_versions"
FOR EACH ROW EXECUTE FUNCTION "strategy_versions_immutable"();
