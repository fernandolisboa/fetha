-- Existing sessions get the epoch rather than now(): a backtest run in progress stamped its
-- dataVersion before this column existed, and a migration-time as_of would move every run's
-- max(asOf) and fail it with data_version_changed although no session changed.
ALTER TABLE "trading_sessions" ADD COLUMN "as_of" timestamp with time zone DEFAULT '1970-01-01T00:00:00Z' NOT NULL;--> statement-breakpoint
ALTER TABLE "trading_sessions" ALTER COLUMN "as_of" SET DEFAULT now();
