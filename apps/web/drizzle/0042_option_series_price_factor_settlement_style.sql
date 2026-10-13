ALTER TABLE "option_series" ADD COLUMN "price_factor" numeric(18, 6) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "option_series" ADD COLUMN "settlement_style" text DEFAULT 'physical' NOT NULL;--> statement-breakpoint
-- ADR-0062: every row already ingested with underlying = 'IBOV11' (the registry's own join key
-- for Ibovespa options) is backfilled to the factor and settlement style the next `instruments`
-- run would set anyway, so no window exists between this migration and that run where an index
-- option prices at factor 1/physical instead of 100/cash.
UPDATE "option_series" SET "price_factor" = '100', "settlement_style" = 'cash' WHERE "underlying" = 'IBOV11';