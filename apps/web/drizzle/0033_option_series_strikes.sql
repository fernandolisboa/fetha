CREATE TABLE "option_series_strikes" (
	"ticker" text NOT NULL,
	"expiry" date NOT NULL,
	"right" text NOT NULL,
	"strike" numeric(18, 8) NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	CONSTRAINT "option_series_strikes_ticker_expiry_right_strike_pk" PRIMARY KEY("ticker","expiry","right","strike")
);
--> statement-breakpoint
CREATE INDEX "option_series_strikes_lookup_idx" ON "option_series_strikes" USING btree ("ticker","expiry","right");--> statement-breakpoint
INSERT INTO "option_series_strikes" ("ticker", "expiry", "right", "strike", "as_of")
SELECT "ticker", "expiry", "right", "strike", min("as_of")
FROM "option_daily_prices"
GROUP BY "ticker", "expiry", "right", "strike"
ON CONFLICT ("ticker", "expiry", "right", "strike") DO NOTHING;--> statement-breakpoint
INSERT INTO "option_series_strikes" ("ticker", "expiry", "right", "strike", "as_of")
SELECT os."ticker", os."expiry", os."right", os."strike", min(os."as_of")
FROM "option_series" os
WHERE NOT EXISTS (
	SELECT 1 FROM "option_daily_prices" dp
	WHERE dp."ticker" = os."ticker"
		AND dp."expiry" = os."expiry"
		AND dp."right" = os."right"
		AND dp."strike" <> os."strike"
)
GROUP BY os."ticker", os."expiry", os."right", os."strike"
ON CONFLICT ("ticker", "expiry", "right", "strike") DO UPDATE
SET "as_of" = LEAST("option_series_strikes"."as_of", excluded."as_of");--> statement-breakpoint
WITH other_strike_max AS (
	SELECT dp."ticker", dp."expiry", dp."right", max(dp."as_of") AS last_other_as_of
	FROM "option_daily_prices" dp
	JOIN "option_series" os
		ON os."ticker" = dp."ticker" AND os."expiry" = dp."expiry" AND os."right" = dp."right"
	WHERE dp."strike" <> os."strike"
	GROUP BY dp."ticker", dp."expiry", dp."right"
),
next_session AS (
	SELECT om."ticker", om."expiry", om."right", ts."open" AS resume_open
	FROM other_strike_max om
	JOIN LATERAL (
		SELECT "open" FROM "trading_sessions"
		WHERE "close" > om."last_other_as_of"
		ORDER BY "close" ASC
		LIMIT 1
	) ts ON true
),
current_strike AS (
	SELECT os."ticker", os."expiry", os."right", os."strike", min(os."as_of") AS as_of
	FROM "option_series" os
	GROUP BY os."ticker", os."expiry", os."right", os."strike"
)
INSERT INTO "option_series_strikes" ("ticker", "expiry", "right", "strike", "as_of")
SELECT cs."ticker", cs."expiry", cs."right", cs."strike", GREATEST(cs."as_of", ns."resume_open")
FROM current_strike cs
JOIN next_session ns
	ON ns."ticker" = cs."ticker" AND ns."expiry" = cs."expiry" AND ns."right" = cs."right"
ON CONFLICT ("ticker", "expiry", "right", "strike") DO NOTHING;