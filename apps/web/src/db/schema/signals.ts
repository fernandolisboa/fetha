import { pgTable, text, timestamp, jsonb, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AdjustmentRule, ExitRule } from "@fetha/contracts";
import type { IndicatorReading, Proposal, SignalKind } from "@fetha/engine";

import { user } from "./auth";
import { strategies, strategyVersions } from "./strategies";

export const signalKindValues = [
  "entry",
  "exit",
  "adjust",
] as const satisfies readonly SignalKind[];

// One actionable evaluation outcome (UBIQUITOUS_LANGUAGE.md "Signal"),
// deposited in the owner's inbox by the nightly evaluation (#19). The
// unique index is what makes re-running the evaluation for an
// already-evaluated (strategy version, instrument, session) a no-op instead
// of a duplicate row: the writer always inserts with onConflictDoNothing.
export const signals = pgTable(
  "signals",
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
    ticker: text("ticker").notNull(),
    timeframe: text("timeframe").notNull(),
    session: text("session").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    kind: text("kind").notNull(),
    // IndicatorReading[] that fired the condition (UBIQUITOUS_LANGUAGE.md
    // "Signal"): always present, even for exit/adjust signals evaluated on
    // an open operation's conditions.
    indicators: jsonb("indicators").$type<IndicatorReading[]>().notNull(),
    // Present for "entry" and "adjust" kinds (the engine's Proposal), null
    // for "exit" (an exit carries no new legs).
    proposal: jsonb("proposal").$type<Proposal | null>(),
    operationId: text("operation_id"),
    rule: jsonb("rule").$type<ExitRule | AdjustmentRule | null>(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("signals_user_version_ticker_session_idx").on(
      table.userId,
      table.strategyVersionId,
      table.ticker,
      table.session,
    ),
    index("signals_user_id_read_at_idx").on(table.userId, table.readAt),
    check("signals_kind_check", sql`${table.kind} in ('entry', 'exit', 'adjust')`),
  ],
);

export const evaluationOutcomeValues = [
  "signal",
  "conditions_not_met",
  "no_series_match",
  "degenerate_strikes",
  "insufficient_data",
  "unsizeable",
] as const;

// The evaluation log (UBIQUITOUS_LANGUAGE.md "Evaluation record"): one row
// per evaluation of one strategy version on one instrument at one
// evaluation time, firing or not. Visible in the log, never in the inbox.
export const evaluations = pgTable(
  "evaluations",
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
    ticker: text("ticker").notNull(),
    session: text("session").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    outcome: text("outcome").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("evaluations_user_version_ticker_session_idx").on(
      table.userId,
      table.strategyVersionId,
      table.ticker,
      table.session,
    ),
    index("evaluations_user_id_strategy_id_idx").on(table.userId, table.strategyId),
  ],
);
