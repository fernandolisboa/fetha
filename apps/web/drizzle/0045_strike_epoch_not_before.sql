ALTER TABLE "option_series_strikes" ADD COLUMN "not_before" timestamp with time zone;--> statement-breakpoint
CREATE OR REPLACE FUNCTION bound_option_strike_epochs(underlyings text[]) RETURNS integer
LANGUAGE sql AS $$
	WITH factors AS (
		SELECT "ticker" AS underlying, "ex_date", "as_of" AS ex_open, "factor"
		FROM "corporate_action_factors"
		WHERE "ticker" = ANY(underlyings) AND "factor" <> 1
	),
	cycles AS (
		SELECT DISTINCT ON ("ticker", "expiry", "right") "ticker", "expiry", "right", "underlying"
		FROM "option_series"
		WHERE "underlying" = ANY(underlyings)
		ORDER BY "ticker", "expiry", "right", "underlying"
	),
	epochs AS (
		SELECT e."ticker", e."expiry", e."right", e."strike", e."as_of", c."underlying",
			lag(e."strike") OVER w AS prev_strike,
			lag(e."as_of") OVER w AS prev_as_of,
			lead(e."as_of") OVER w AS next_as_of
		FROM "option_series_strikes" e
		JOIN cycles c ON c."ticker" = e."ticker" AND c."expiry" = e."expiry" AND c."right" = e."right"
		WINDOW w AS (PARTITION BY e."ticker", e."expiry", e."right" ORDER BY e."as_of", e."strike")
	),
	transition_bounds AS (
		SELECT DISTINCT ON (ep."ticker", ep."expiry", ep."right", ep."strike")
			ep."ticker", ep."expiry", ep."right", ep."strike", f.ex_open AS bound
		FROM epochs ep
		JOIN factors f ON f.underlying = ep."underlying"
		WHERE ep.prev_strike IS NOT NULL
			AND f."ex_date" <= ep."expiry"
			AND ep.prev_as_of < f.ex_open
			AND ep."as_of" < f.ex_open
			AND (ep.next_as_of IS NULL OR ep.next_as_of > f.ex_open)
			AND round(ep.prev_strike * f."factor", 2) = ep."strike"
		ORDER BY ep."ticker", ep."expiry", ep."right", ep."strike", f."ex_date" ASC
	),
	first_bounds AS (
		SELECT DISTINCT ON (ep."ticker", ep."expiry", ep."right", ep."strike")
			ep."ticker", ep."expiry", ep."right", ep."strike", f.ex_open AS bound
		FROM epochs ep
		JOIN factors f ON f.underlying = ep."underlying"
		WHERE ep.prev_strike IS NULL
			AND f."ex_date" <= ep."expiry"
			AND ep."as_of" < f.ex_open
			AND (ep.next_as_of IS NULL OR ep.next_as_of > f.ex_open)
			AND EXISTS (
				SELECT 1 FROM "option_daily_prices" dp
				WHERE dp."ticker" = ep."ticker" AND dp."expiry" = ep."expiry"
					AND dp."right" = ep."right" AND dp."strike" = ep."strike"
					AND dp."session" >= f."ex_date"
			)
			AND NOT EXISTS (
				SELECT 1 FROM "option_daily_prices" dp
				WHERE dp."ticker" = ep."ticker" AND dp."expiry" = ep."expiry"
					AND dp."right" = ep."right" AND dp."session" < f."ex_date"
			)
		ORDER BY ep."ticker", ep."expiry", ep."right", ep."strike", f."ex_date" DESC
	),
	bounds AS (
		SELECT * FROM transition_bounds
		UNION ALL
		SELECT * FROM first_bounds
	),
	targets AS (
		SELECT ep."ticker", ep."expiry", ep."right", ep."strike", b.bound
		FROM epochs ep
		LEFT JOIN bounds b
			ON b."ticker" = ep."ticker" AND b."expiry" = ep."expiry"
			AND b."right" = ep."right" AND b."strike" = ep."strike"
	),
	updated AS (
		UPDATE "option_series_strikes" s
		SET "not_before" = t.bound
		FROM targets t
		WHERE s."ticker" = t."ticker" AND s."expiry" = t."expiry"
			AND s."right" = t."right" AND s."strike" = t."strike"
			AND s."not_before" IS DISTINCT FROM t.bound
		RETURNING 1
	)
	SELECT count(*)::integer FROM updated
$$;--> statement-breakpoint
SELECT bound_option_strike_epochs(ARRAY(SELECT DISTINCT "ticker" FROM "corporate_action_factors"));
