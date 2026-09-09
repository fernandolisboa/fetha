-- candles and option_daily_prices are declared as ordinary tables in
-- src/db/schema/market-data.ts (drizzle-kit has no notion of native Postgres
-- partitioning), then turned into PARTITION BY RANGE (session) parents by hand
-- here (docs/adr/0017): monthly partitions, one CREATE TABLE ... PARTITION OF per
-- calendar month, keeps each partition small enough that a session's worth of
-- ingestion only ever touches one or two partitions. create_monthly_partitions
-- is idempotent (CREATE TABLE IF NOT EXISTS) and is called again by the
-- ingestion job itself before every write, so a new month never needs a migration.
CREATE TABLE "candles" (
	"ticker" text NOT NULL,
	"timeframe" text NOT NULL,
	"session" date NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"open" numeric(18, 2) NOT NULL,
	"high" numeric(18, 2) NOT NULL,
	"low" numeric(18, 2) NOT NULL,
	"close" numeric(18, 2) NOT NULL,
	"traded_quantity" bigint NOT NULL,
	CONSTRAINT "candles_ticker_timeframe_session_pk" PRIMARY KEY("ticker","timeframe","session")
) PARTITION BY RANGE ("session");
--> statement-breakpoint
CREATE TABLE "corporate_action_factors" (
	"ticker" text NOT NULL,
	"ex_date" date NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"factor" numeric(18, 8) NOT NULL,
	CONSTRAINT "corporate_action_factors_ticker_ex_date_pk" PRIMARY KEY("ticker","ex_date")
);
--> statement-breakpoint
CREATE TABLE "data_version" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"session" date NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"row_count" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "macro_points" (
	"series" text NOT NULL,
	"date" date NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"annual_rate" numeric(18, 8) NOT NULL,
	CONSTRAINT "macro_points_series_date_pk" PRIMARY KEY("series","date")
);
--> statement-breakpoint
CREATE TABLE "option_daily_prices" (
	"ticker" text NOT NULL,
	"session" date NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"average" numeric(18, 2),
	"close" numeric(18, 2),
	"trades" integer NOT NULL,
	"traded_quantity" bigint NOT NULL,
	CONSTRAINT "option_daily_prices_ticker_session_pk" PRIMARY KEY("ticker","session")
) PARTITION BY RANGE ("session");
--> statement-breakpoint
CREATE TABLE "option_series" (
	"ticker" text PRIMARY KEY NOT NULL,
	"underlying" text NOT NULL,
	"right" text NOT NULL,
	"strike" numeric(18, 8) NOT NULL,
	"expiry" date NOT NULL,
	"style" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_sessions" (
	"date" date PRIMARY KEY NOT NULL,
	"open" timestamp with time zone NOT NULL,
	"close" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION create_monthly_partitions(parent_table text, start_date date, end_date date)
RETURNS void AS $$
DECLARE
	partition_start date := date_trunc('month', start_date)::date;
	partition_end date;
	partition_name text;
BEGIN
	WHILE partition_start < end_date LOOP
		partition_end := (partition_start + interval '1 month')::date;
		partition_name := parent_table || '_' || to_char(partition_start, 'YYYY_MM');
		EXECUTE format(
			'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
			partition_name, parent_table, partition_start, partition_end
		);
		partition_start := partition_end;
	END LOOP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
SELECT create_monthly_partitions('candles', '2024-01-01', '2027-01-01');
--> statement-breakpoint
SELECT create_monthly_partitions('option_daily_prices', '2024-01-01', '2027-01-01');
