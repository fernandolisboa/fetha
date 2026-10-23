CREATE TABLE "cash_distributions" (
	"underlying" text NOT NULL,
	"ex_date" date NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"amount" numeric(18, 8) NOT NULL,
	"series_count" integer NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_distributions_underlying_ex_date_pk" PRIMARY KEY("underlying","ex_date")
);
