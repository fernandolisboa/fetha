CREATE TABLE "filing_labels" (
	"protocol" text NOT NULL,
	"version" integer NOT NULL,
	"outcome" text NOT NULL,
	"topic" text,
	"tone" text,
	"summary" text,
	"reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"model" text,
	"prompt_version" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "filing_labels_protocol_version_pk" PRIMARY KEY("protocol","version"),
	CONSTRAINT "filing_labels_outcome_check" CHECK (outcome in ('labelled', 'rejected', 'unreadable', 'pending')),
	CONSTRAINT "filing_labels_topic_check" CHECK (topic is null or topic in ('results', 'dividends', 'guidance', 'm_and_a', 'debt', 'litigation', 'management', 'buyback', 'offering', 'other')),
	CONSTRAINT "filing_labels_tone_check" CHECK (tone is null or tone in ('positive', 'neutral', 'negative')),
	CONSTRAINT "filing_labels_reason_check" CHECK (reason is null or reason in ('refusal', 'incomplete', 'schema', 'figure', 'link', 'bad_request', 'not_pdf', 'too_large', 'unavailable')),
	CONSTRAINT "filing_labels_labelled_check" CHECK ((outcome = 'labelled') = (topic is not null and tone is not null and summary is not null))
);
--> statement-breakpoint
CREATE TABLE "news_articles" (
	"provider" text NOT NULL,
	"article_id" text NOT NULL,
	"ticker" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"source" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"sentiment" numeric(5, 4) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_articles_provider_article_id_ticker_pk" PRIMARY KEY("provider","article_id","ticker"),
	CONSTRAINT "news_articles_provider_check" CHECK (provider in ('marketaux'))
);
--> statement-breakpoint
CREATE TABLE "news_tone_points" (
	"cnpj" text NOT NULL,
	"day" date NOT NULL,
	"tone" numeric(8, 4) NOT NULL,
	"articles" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_tone_points_cnpj_day_pk" PRIMARY KEY("cnpj","day")
);
--> statement-breakpoint
CREATE TABLE "sentiment_fetches" (
	"source" text NOT NULL,
	"subject" text NOT NULL,
	"query" text,
	"status" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sentiment_fetches_source_subject_pk" PRIMARY KEY("source","subject"),
	CONSTRAINT "sentiment_fetches_source_check" CHECK (source in ('gdelt', 'marketaux')),
	CONSTRAINT "sentiment_fetches_status_check" CHECK (status in ('ok', 'rate_limited', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "filing_labels" ADD CONSTRAINT "filing_labels_company_filing_fk" FOREIGN KEY ("protocol","version") REFERENCES "public"."company_filings"("protocol","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "news_articles_ticker_published_at_idx" ON "news_articles" USING btree ("ticker","published_at");