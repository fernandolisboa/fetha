CREATE TABLE "contemplated_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"structure_id" text NOT NULL,
	"underlying" text NOT NULL,
	"legs" jsonb NOT NULL,
	"session" date NOT NULL,
	"net_premium_centavos" bigint NOT NULL,
	"max_loss_centavos" bigint,
	"max_gain_centavos" bigint,
	"breached_limits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"declared_capital" bigint NOT NULL,
	"limits" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contemplated_operations" ADD CONSTRAINT "contemplated_operations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contemplated_operations" ADD CONSTRAINT "contemplated_operations_structure_id_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_profiles" ADD CONSTRAINT "risk_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contemplated_operations_user_id_created_at_idx" ON "contemplated_operations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "risk_profiles_user_id_created_at_idx" ON "risk_profiles" USING btree ("user_id","created_at");