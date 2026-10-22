ALTER TABLE "implied_volatility_index" ADD COLUMN "stale" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "implied_volatility_index" SET "stale" = true WHERE "computed_at" < '2026-10-01T09:00:00Z';--> statement-breakpoint
DELETE FROM "ingestion_runs"
WHERE "source" = 'iv_index'
	AND "status" = 'succeeded'
	AND "session" IN (SELECT DISTINCT "session" FROM "implied_volatility_index" WHERE "stale");
