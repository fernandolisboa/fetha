ALTER TABLE "implied_volatility_index" ADD COLUMN "stale" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "implied_volatility_index" SET "stale" = true
WHERE "computed_at" < '2026-10-01T09:00:00Z'
	OR "underlying" IN (SELECT "ticker" FROM "corporate_action_factors");
