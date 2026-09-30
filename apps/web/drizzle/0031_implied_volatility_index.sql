CREATE TABLE "implied_volatility_index" (
	"underlying" text NOT NULL,
	"session" date NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"implied_volatility" numeric(18, 8) NOT NULL,
	"method" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "implied_volatility_index_underlying_session_pk" PRIMARY KEY("underlying","session")
);
--> statement-breakpoint
CREATE INDEX "implied_volatility_index_session_idx" ON "implied_volatility_index" USING btree ("session");