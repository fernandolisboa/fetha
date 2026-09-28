CREATE INDEX "candles_session_idx" ON "candles" USING btree ("session");--> statement-breakpoint
CREATE INDEX "option_daily_prices_session_idx" ON "option_daily_prices" USING btree ("session");