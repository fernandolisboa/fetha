CREATE TABLE "fills" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "fills_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ticker" text NOT NULL,
	"asset_class" text NOT NULL,
	"side" text NOT NULL,
	"quantity" integer NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"session" date NOT NULL,
	"costs_centavos" bigint DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	"expiry" date,
	"import_key" text,
	"operation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fills_side_check" CHECK ("fills"."side" in ('buy', 'sell')),
	CONSTRAINT "fills_asset_class_check" CHECK ("fills"."asset_class" in ('stock', 'option')),
	CONSTRAINT "fills_source_check" CHECK ("fills"."source" in ('manual', 'b3_import', 'settlement')),
	CONSTRAINT "fills_quantity_positive_check" CHECK ("fills"."quantity" > 0),
	CONSTRAINT "fills_price_non_negative_check" CHECK ("fills"."price" >= 0),
	CONSTRAINT "fills_costs_non_negative_check" CHECK ("fills"."costs_centavos" >= 0),
	CONSTRAINT "fills_stock_has_no_expiry_check" CHECK ("fills"."asset_class" = 'option' or "fills"."expiry" is null)
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"underlying" text NOT NULL,
	"status" text NOT NULL,
	"expiry" date,
	"opened_at" date NOT NULL,
	"closed_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_status_check" CHECK ("operations"."status" in ('open', 'closed', 'expired')),
	CONSTRAINT "operations_closed_at_check" CHECK (("operations"."status" = 'open') = ("operations"."closed_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "operations_id_user_id_idx" ON "operations" USING btree ("id","user_id");--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_operation_id_user_id_operations_id_user_id_fk" FOREIGN KEY ("operation_id","user_id") REFERENCES "public"."operations"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fills_user_id_session_idx" ON "fills" USING btree ("user_id","session");--> statement-breakpoint
CREATE INDEX "fills_operation_id_idx" ON "fills" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fills_user_id_import_key_idx" ON "fills" USING btree ("user_id","import_key") WHERE "fills"."import_key" is not null;--> statement-breakpoint
CREATE INDEX "operations_user_id_status_idx" ON "operations" USING btree ("user_id","status");