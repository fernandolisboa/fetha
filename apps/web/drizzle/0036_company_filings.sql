CREATE TABLE "company_filings" (
	"protocol" text NOT NULL,
	"version" integer NOT NULL,
	"cnpj" text NOT NULL,
	"company_name" text NOT NULL,
	"category" text NOT NULL,
	"kind" text,
	"subject" text NOT NULL,
	"delivered_on" date NOT NULL,
	"document_url" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_filings_protocol_version_pk" PRIMARY KEY("protocol","version")
);
--> statement-breakpoint
CREATE TABLE "company_tickers" (
	"ticker" text PRIMARY KEY NOT NULL,
	"cnpj" text NOT NULL,
	"reference_date" date NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "company_filings_cnpj_delivered_on_idx" ON "company_filings" USING btree ("cnpj","delivered_on");--> statement-breakpoint
CREATE INDEX "company_filings_delivered_on_idx" ON "company_filings" USING btree ("delivered_on");--> statement-breakpoint
CREATE INDEX "company_tickers_cnpj_idx" ON "company_tickers" USING btree ("cnpj");