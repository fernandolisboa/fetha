import {
  bigint,
  check,
  date,
  index,
  integer,
  json,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  BacktestCheckpoint,
  BacktestRun,
  CostModel,
  LimitMode,
  RiskProfile,
  SizingRule,
  Structure,
  Ticker,
} from "@fetha/contracts";

import { user } from "./auth";
import { strategies, strategyVersions } from "./strategies";

export const backtestRunStatuses = ["pending", "running", "paused", "complete", "failed"] as const;

// A run row is written many times while it progresses (checkpoint after
// each chunked call) but never again once it reaches "complete"
// (CONTEXT.md "Backtest run"): the database enforces that half of the
// invariant with a trigger the same way strategy_versions enforces full
// immutability (0004_empty_skreet.sql), since Drizzle's schema builder has
// no first-class trigger API.
export const backtestRuns = pgTable(
  "backtest_runs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    strategyId: text("strategy_id")
      .notNull()
      .references(() => strategies.id, { onDelete: "cascade" }),
    strategyVersionId: text("strategy_version_id")
      .notNull()
      .references(() => strategyVersions.id, { onDelete: "cascade" }),
    // Resolved from the (mutable) structures catalog once, at creation, and
    // reused on every chunk: a catalog edit between chunks must never
    // invalidate a paused run's checkpoint.
    structure: jsonb("structure").$type<Structure>().notNull(),
    universe: jsonb("universe").$type<Ticker[]>().notNull(),
    periodFrom: date("period_from", { mode: "string" }).notNull(),
    periodTo: date("period_to", { mode: "string" }).notNull(),
    initialCapital: bigint("initial_capital", { mode: "number" }).notNull(),
    costModel: jsonb("cost_model").$type<CostModel>().notNull(),
    riskProfile: jsonb("risk_profile").$type<RiskProfile>().notNull(),
    limits: text("limits").$type<LimitMode>().notNull(),
    sizing: jsonb("sizing").$type<SizingRule | null>(),
    seed: integer("seed").notNull(),
    configDigest: text("config_digest").notNull(),
    status: text("status")
      .$type<(typeof backtestRunStatuses)[number]>()
      .notNull()
      .default("pending"),
    // A plain `json` column, not `jsonb`: the engine iterates checkpoint
    // maps (pendingEntries, pendingExits, pendingSettlements) in insertion
    // order, and `jsonb` does not preserve key order on round-trip, which
    // would silently reorder those maps and break the chunked-run ==
    // uninterrupted-run invariant.
    checkpoint: json("checkpoint").$type<BacktestCheckpoint | null>(),
    result: jsonb("result").$type<BacktestRun | null>(),
    sessionsDone: integer("sessions_done"),
    sessionsTotal: integer("sessions_total"),
    // Stamped at the run's first chunk as `max(asOf)` over the loaded
    // MarketView, then compared on every resume: a candle or calendar
    // revision between chunks changes it, and the run fails rather than
    // silently mixing two datasets in one immutable result.
    dataVersion: text("data_version"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("backtest_runs_user_id_idx").on(table.userId),
    index("backtest_runs_strategy_id_idx").on(table.strategyId),
    check(
      "backtest_runs_status_check",
      sql`${table.status} in ('pending', 'running', 'paused', 'complete', 'failed')`,
    ),
    check("backtest_runs_limits_check", sql`${table.limits} in ('enforce', 'warn')`),
  ],
);
