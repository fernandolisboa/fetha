CREATE TABLE "exchange_rates" (
	"pair" text NOT NULL,
	"date" date NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	CONSTRAINT "exchange_rates_pair_date_pk" PRIMARY KEY("pair","date")
);
