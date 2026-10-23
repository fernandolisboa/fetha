import { sql } from "drizzle-orm";
import { filingCategories } from "@fetha/contracts";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { ExchangeRatePair } from "./adapters/bacen-sgs/schema";

// Shared reference data (docs/adr/0017): no user_id, read-only to users. `candles`
// and `optionDailyPrices` are declared here as ordinary tables for Drizzle's query
// builder; the migration SQL turns them into `PARTITION BY RANGE (session)` parents
// by hand, since drizzle-kit does not understand native Postgres partitioning.
export const candles = pgTable(
  "candles",
  {
    ticker: text("ticker").notNull(),
    timeframe: text("timeframe").notNull(),
    session: date("session", { mode: "string" }).notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    open: numeric("open", { precision: 18, scale: 6 }).notNull(),
    high: numeric("high", { precision: 18, scale: 6 }).notNull(),
    low: numeric("low", { precision: 18, scale: 6 }).notNull(),
    close: numeric("close", { precision: 18, scale: 6 }).notNull(),
    tradedQuantity: bigint("traded_quantity", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ticker, table.timeframe, table.session] }),
    // Backs `searchInstruments`'s `LIKE '<PREFIX>%'` (#74): `text_pattern_ops`
    // is the opclass a plain B-tree needs to serve a prefix `LIKE` from an
    // index at all, `ILIKE` never can. `CREATE INDEX` on a partitioned
    // parent (docs/adr/0017) propagates to every existing and future
    // partition, so no per-partition index is needed here.
    index("candles_ticker_pattern_idx").using("btree", table.ticker.op("text_pattern_ops")),
    // Backs the calendar delete's `exists (... where session = ...)` probe
    // (#210), which runs under the cotahist lock: the primary key leads with
    // ticker, so without this the probe scans partitions row by row. Same for
    // `option_daily_prices_session_idx` below.
    index("candles_session_idx").on(table.session),
  ],
);

// isin is the B3 instruments registry's stable key: option tickers are
// reused across cycles and strikes get adjusted, so ticker alone cannot be
// the conflict target (ADR-0017).
export const optionSeries = pgTable(
  "option_series",
  {
    isin: text("isin").primaryKey(),
    ticker: text("ticker").notNull(),
    underlying: text("underlying").notNull(),
    right: text("right").notNull(),
    strike: numeric("strike", { precision: 18, scale: 8 }).notNull(),
    expiry: date("expiry", { mode: "string" }).notNull(),
    style: text("style").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    // B3 registry `PricFctr` (ADR-0063): a figure in the series' own quotation unit (index
    // points for an index option) divided by it is reais per contract. 1 for every equity
    // option, the pre-existing behaviour.
    priceFactor: numeric("price_factor", { precision: 18, scale: 6 }).notNull().default("1"),
    // The registry's own category (`OPTION ON INDEX` -> "cash", anything else -> "physical",
    // ADR-0063): never inferred from `priceFactor`, a separate registry fact.
    settlementStyle: text("settlement_style").notNull().default("physical"),
  },
  (table) => [
    // Backs the palette's `LIKE '<PREFIX>%'` series search (#241) the same
    // way `candles_ticker_pattern_idx` backs the instrument search (#74), and
    // the series page's ticker lookup.
    index("option_series_ticker_pattern_idx").using("btree", table.ticker.op("text_pattern_ops")),
  ],
);

export const optionDailyPrices = pgTable(
  "option_daily_prices",
  {
    ticker: text("ticker").notNull(),
    session: date("session", { mode: "string" }).notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    right: text("right").notNull(),
    strike: numeric("strike", { precision: 18, scale: 8 }).notNull(),
    expiry: date("expiry", { mode: "string" }).notNull(),
    average: numeric("average", { precision: 18, scale: 6 }),
    close: numeric("close", { precision: 18, scale: 6 }),
    // COTAHIST FATCOT (quotation-lot factor): average/close are premiums per
    // contract already divided by it, while strike is always in raw points
    // (docs/adr/0017, "PREEXE divides by 100 only"). Persisted so a reader
    // can tell the two fields are on different units for the same row.
    factor: numeric("factor", { precision: 18, scale: 6 }).notNull().default("1"),
    trades: integer("trades").notNull(),
    tradedQuantity: bigint("traded_quantity", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ticker, table.session] }),
    index("option_daily_prices_session_idx").on(table.session),
  ],
);

// One row per epoch: the first instant a listing cycle (ticker, expiry,
// right) is known to have traded or been registered at a given strike
// (ADR-0056). `option_series.strike`/`asOf` alone conflate every strike a
// series has ever carried under its earliest sighting, which leaks a
// post-corporate-action strike into a pre-event instant; this table is the
// strike's own point-in-time history, keyed by the strike itself so a split
// or a dividend adjustment adds a row instead of overwriting one.
export const optionSeriesStrikes = pgTable(
  "option_series_strikes",
  {
    ticker: text("ticker").notNull(),
    expiry: date("expiry", { mode: "string" }).notNull(),
    right: text("right").notNull(),
    strike: numeric("strike", { precision: 18, scale: 8 }).notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    // The open of a recorded corporate action's ex-date (#272), set only by
    // `bound_option_strike_epochs` when `as_of` dates this strike before the
    // event that produced it. Kept beside `as_of`, never folded into it, so
    // neutralizing the factor clears it and the observed date comes back.
    notBefore: timestamp("not_before", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.ticker, table.expiry, table.right, table.strike] }),
    index("option_series_strikes_lookup_idx").on(table.ticker, table.expiry, table.right),
  ],
);

export const macroPoints = pgTable(
  "macro_points",
  {
    series: text("series").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    annualRate: numeric("annual_rate", { precision: 18, scale: 8 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.series, table.date] })],
);

export const tradingSessions = pgTable("trading_sessions", {
  date: date("date", { mode: "string" }).primaryKey(),
  open: timestamp("open", { withTimezone: true }).notNull(),
  close: timestamp("close", { withTimezone: true }).notNull(),
  asOf: timestamp("as_of", { withTimezone: true }).notNull().defaultNow(),
});

export const corporateActionFactors = pgTable(
  "corporate_action_factors",
  {
    ticker: text("ticker").notNull(),
    exDate: date("ex_date", { mode: "string" }).notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    factor: numeric("factor", { precision: 18, scale: 8 }).notNull(),
    // Write-time stamp, distinct from `as_of`: the owner can type a factor
    // for a past ex-date today, so `as_of` (that session's own open) never
    // moves once the row is corrected, and `MarketView.dataVersion` would
    // never see the correction (docs/adr/0054's `computed_at` for the same
    // reason, docs/adr/0052).
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.ticker, table.exDate] })],
);

// One cash distribution (dividend, JCP) per underlying and ex-date, read off the uniform
// drop B3 applies to every listed option strike of the underlying on that session
// (docs/adr/0070). `amount` is reais per share as of the ex-date, before any later split;
// `as_of` is the ex-date session's close, when COTAHIST first shows the lowered strikes.
export const cashDistributions = pgTable(
  "cash_distributions",
  {
    underlying: text("underlying").notNull(),
    exDate: date("ex_date", { mode: "string" }).notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    amount: numeric("amount", { precision: 18, scale: 8 }).notNull(),
    seriesCount: integer("series_count").notNull(),
    // Write-time stamp folded into `MarketView.dataVersion`, like
    // `implied_volatility_index.computed_at`: a backfilled distribution carries a past
    // `as_of` a chunked run may already have read (docs/adr/0054).
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.underlying, table.exDate] })],
);

// One implied-volatility index point per underlying and session, computed by
// the engine from that session's own chain (docs/adr/0054). `as_of` is the
// session's close, the instant its candles carry (docs/adr/0051). Shared
// reference data like the rest of this file; small enough (one row per
// optionable underlying per session) to need no monthly partitioning.
export const impliedVolatilityIndexPoints = pgTable(
  "implied_volatility_index",
  {
    underlying: text("underlying").notNull(),
    session: date("session", { mode: "string" }).notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    impliedVolatility: numeric("implied_volatility", { precision: 18, scale: 8 }).notNull(),
    method: text("method").notNull(),
    // Write-time stamp, distinct from `as_of`: a backfilled point can carry
    // the same session close as an already-loaded candle, so `as_of` alone
    // cannot tell a MarketView that new IV data has landed for a window it
    // already read (docs/adr/0054).
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    // Marks a point computed under rules since corrected (#275). It keeps
    // serving reads until the nightly step recomputes it in place, so an
    // `iv_rank` window never loses a session while the recompute drains.
    stale: boolean("stale").notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.underlying, table.session] }),
    index("implied_volatility_index_session_idx").on(table.session),
  ],
);

// USD/BRL and EUR/BRL selling PTAX, Bacen's own daily fixing (docs/adr/0061):
// shared read-only reference data like the rest of this file, no user_id.
// `as_of` is the fixed publication instant the PTAX parser stamps
// (13:30 America/Sao_Paulo), independent of any B3 trading-session calendar.
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    pair: text("pair").$type<ExchangeRatePair>().notNull(),
    date: date("date", { mode: "string" }).notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    rate: numeric("rate", { precision: 18, scale: 8 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.pair, table.date] })],
);

export const companyFilingCategoryValues = filingCategories;
export type CompanyFilingCategory = (typeof companyFilingCategoryValues)[number];

// Filings listed companies deliver to the CVM (docs/adr/0060), one row per
// (protocol, version): a re-presentation is a new version of the same
// protocol, so readers keep only each protocol's highest version. Shared
// reference data, written only by the nightly ingestion.
export const companyFilings = pgTable(
  "company_filings",
  {
    protocol: text("protocol").notNull(),
    version: integer("version").notNull(),
    cnpj: text("cnpj").notNull(),
    companyName: text("company_name").notNull(),
    category: text("category").$type<CompanyFilingCategory>().notNull(),
    kind: text("kind"),
    subject: text("subject").notNull(),
    deliveredOn: date("delivered_on", { mode: "string" }).notNull(),
    documentUrl: text("document_url").notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.protocol, table.version] }),
    index("company_filings_cnpj_delivered_on_idx").on(table.cnpj, table.deliveredOn),
    index("company_filings_delivered_on_idx").on(table.deliveredOn),
  ],
);

// A B3 trading code to the CNPJ of the company that issues it, from the
// CVM's FCA securities table (docs/adr/0060).
export const companyTickers = pgTable(
  "company_tickers",
  {
    ticker: text("ticker").primaryKey(),
    cnpj: text("cnpj").notNull(),
    referenceDate: date("reference_date", { mode: "string" }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("company_tickers_cnpj_idx").on(table.cnpj)],
);

export const ingestionSourceValues = [
  "cotahist",
  "instruments",
  "sgs",
  "calendar",
  "iv_index",
  "cvm_filings",
  "ptax",
  "indexes",
  "dividends",
] as const;
export type IngestionSource = (typeof ingestionSourceValues)[number];

export const ingestionStatusValues = ["running", "succeeded", "failed"] as const;
export type IngestionStatus = (typeof ingestionStatusValues)[number];

// ingestion_runs is shared, read-only ingestion metadata (ADR-0017): no
// user_id, the system alone writes it, users never query it directly.
export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    source: text("source").$type<IngestionSource>().notNull(),
    session: date("session", { mode: "string" }).notNull(),
    status: text("status").$type<IngestionStatus>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    rowCount: integer("row_count"),
    error: text("error"),
  },
  (table) => [
    uniqueIndex("ingestion_runs_source_session_succeeded_idx")
      .on(table.source, table.session)
      .where(sql`${table.status} = 'succeeded'`),
  ],
);
