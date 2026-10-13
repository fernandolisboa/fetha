CREATE TABLE "radar_matches" (
	"underlying" text NOT NULL,
	"session" date NOT NULL,
	"recipe_id" text NOT NULL,
	"facts" jsonb NOT NULL,
	"legs" jsonb NOT NULL,
	CONSTRAINT "radar_matches_underlying_session_recipe_id_pk" PRIMARY KEY("underlying","session","recipe_id")
);
--> statement-breakpoint
CREATE TABLE "radar_readings" (
	"underlying" text NOT NULL,
	"session" date NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"reading" jsonb,
	"computed_at" timestamp with time zone,
	CONSTRAINT "radar_readings_underlying_session_pk" PRIMARY KEY("underlying","session")
);
--> statement-breakpoint
ALTER TABLE "radar_matches" ADD CONSTRAINT "radar_matches_underlying_session_radar_readings_underlying_session_fk" FOREIGN KEY ("underlying","session") REFERENCES "public"."radar_readings"("underlying","session") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "radar_readings_session_idx" ON "radar_readings" USING btree ("session");