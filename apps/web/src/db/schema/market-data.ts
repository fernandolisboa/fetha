import {
  bigint,
  date,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
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
    open: numeric("open", { precision: 18, scale: 2 }).notNull(),
    high: numeric("high", { precision: 18, scale: 2 }).notNull(),
    low: numeric("low", { precision: 18, scale: 2 }).notNull(),
    close: numeric("close", { precision: 18, scale: 2 }).notNull(),
    tradedQuantity: bigint("traded_quantity", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.ticker, table.timeframe, table.session] })],
);

export const optionSeries = pgTable("option_series", {
  ticker: text("ticker").primaryKey(),
  underlying: text("underlying").notNull(),
  right: text("right").notNull(),
  strike: numeric("strike", { precision: 18, scale: 8 }).notNull(),
  expiry: date("expiry", { mode: "string" }).notNull(),
  style: text("style").notNull(),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
});

export const optionDailyPrices = pgTable(
  "option_daily_prices",
  {
    ticker: text("ticker").notNull(),
    session: date("session", { mode: "string" }).notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    average: numeric("average", { precision: 18, scale: 2 }),
    close: numeric("close", { precision: 18, scale: 2 }),
    trades: integer("trades").notNull(),
    tradedQuantity: bigint("traded_quantity", { mode: "number" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.ticker, table.session] })],
);

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
});

export const ingestionSourceValues = ["cotahist", "instruments", "sgs", "calendar"] as const;
export type IngestionSource = (typeof ingestionSourceValues)[number];

export const ingestionStatusValues = ["running", "succeeded", "failed"] as const;
export type IngestionStatus = (typeof ingestionStatusValues)[number];

export const ingestionRuns = pgTable("ingestion_runs", {
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
});

export const dataVersion = pgTable("data_version", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
