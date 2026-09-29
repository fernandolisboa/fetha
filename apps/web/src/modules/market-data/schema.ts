import { sql } from "drizzle-orm";
import {
  bigint,
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
  },
  (table) => [primaryKey({ columns: [table.ticker, table.exDate] })],
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
  },
  (table) => [
    primaryKey({ columns: [table.underlying, table.session] }),
    index("implied_volatility_index_session_idx").on(table.session),
  ],
);

export const ingestionSourceValues = [
  "cotahist",
  "instruments",
  "sgs",
  "calendar",
  "iv_index",
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
