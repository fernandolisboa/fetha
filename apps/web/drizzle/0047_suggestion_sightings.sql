CREATE TABLE "suggestion_sightings" (
	"user_id" text NOT NULL,
	"suggestion_id" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suggestion_sightings_user_id_suggestion_id_pk" PRIMARY KEY("user_id","suggestion_id")
);
--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "suggestion_archive_after_hours" integer;--> statement-breakpoint
ALTER TABLE "suggestion_sightings" ADD CONSTRAINT "suggestion_sightings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_sightings" ADD CONSTRAINT "suggestion_sightings_suggestion_id_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suggestion_sightings_suggestion_id_idx" ON "suggestion_sightings" USING btree ("suggestion_id");--> statement-breakpoint
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_suggestion_archive_after_hours_positive" CHECK ("preferences"."suggestion_archive_after_hours" > 0);