DROP INDEX "signals_user_version_ticker_session_idx";--> statement-breakpoint
ALTER TABLE "signals" ALTER COLUMN "operation_id" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "signals" ALTER COLUMN "operation_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "signals_user_version_ticker_session_kind_operation_idx" ON "signals" USING btree ("user_id","strategy_version_id","ticker","session","kind","operation_id");