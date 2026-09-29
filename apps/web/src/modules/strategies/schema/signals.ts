import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
  integer,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AdjustmentRule, ExitRule } from "@fetha/contracts";
import { signalKinds, type IndicatorReading, type Proposal } from "@fetha/engine";

import { user } from "../../auth/schema";
import { strategies, strategyVersions } from "./strategies";

// No operation exists to reference yet (the portfolio module ships later),
// so every signal's operation_id is this sentinel rather than SQL NULL: a
// NULL would make every no-operation row distinct under Postgres' "NULLs are
// never equal" unique-index rule, defeating the idempotency this table
// exists for (docs/agents unique index below).
export const NO_OPERATION_ID = "";

export const reevaluationStatuses = ["applied", "unchanged", "failed"] as const;

// The audit trail of every session re-evaluation (docs/adr/0047, #84): who
// asked (the owning user; nobody else can), for which strategy and session,
// what came of it and how many rows it touched. A failed recomputation is
// recorded here and nowhere else: it never touches `signals` or
// `evaluations`.
export const signalReevaluations = pgTable(
  "signal_reevaluations",
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
    session: text("session").notNull(),
    status: text("status").notNull(),
    failureReason: text("failure_reason"),
    evaluationsSuperseded: integer("evaluations_superseded").notNull().default(0),
    signalsRetracted: integer("signals_retracted").notNull().default(0),
    signalsReplaced: integer("signals_replaced").notNull().default(0),
    signalsAdded: integer("signals_added").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("signal_reevaluations_user_id_created_at_idx").on(table.userId, table.createdAt),
    check(
      "signal_reevaluations_status_check",
      sql`${table.status} in (${sql.raw(reevaluationStatuses.map((status) => `'${status}'`).join(", "))})`,
    ),
  ],
);

// One actionable evaluation outcome (UBIQUITOUS_LANGUAGE.md "Signal"),
// deposited in the owner's inbox by the nightly evaluation (#19). The
// unique index is what makes re-running the evaluation for an
// already-evaluated (strategy version, instrument, session, kind,
// operation) a no-op instead of a duplicate row: the writer always inserts
// with onConflictDoNothing. `kind` and `operation_id` are both part of the
// key, not just ticker/session, so once the portfolio module feeds open
// operations, two different exits on the same ticker/session no longer
// collapse into one row.
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
    operationId: text("operation_id").notNull().default(NO_OPERATION_ID),
    rule: jsonb("rule").$type<ExitRule | AdjustmentRule | null>(),
    readAt: timestamp("read_at", { withTimezone: true }),
    // Set when a re-evaluation wrote this row, null for the nightly run.
    reevaluationId: text("reevaluation_id").references(() => signalReevaluations.id),
    // Set, once, when a re-evaluation retracts or replaces this row
    // (docs/adr/0047): the row stays, it just leaves the inbox. The
    // `signals_append_only` trigger lets no other column change except
    // `read_at`.
    supersededBy: text("superseded_by").references((): AnyPgColumn => signalReevaluations.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("signals_user_version_ticker_session_kind_operation_idx")
      .on(
        table.userId,
        table.strategyVersionId,
        table.ticker,
        table.session,
        table.kind,
        table.operationId,
      )
      .where(sql`${table.supersededBy} is null`),
    index("signals_user_id_read_at_idx").on(table.userId, table.readAt),
    check(
      "signals_kind_check",
      sql`${table.kind} in (${sql.raw(signalKinds.map((kind) => `'${kind}'`).join(", "))})`,
    ),
  ],
);

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
    // The engine's stable `EvaluationReason` code (#80) for a row built
    // straight from an `EvaluationRecord`, or one of the web-authored
    // `WebEvaluationReason` codes (#133: `unknown_structure`, `engine_error`,
    // `catchup_clamped`, `unsatisfiable_collection`, `market_view_too_large`,
    // `no_market_data`) for an outcome `evaluate-signals.ts` records itself,
    // outside any `EvaluationRecord`. Null only for a row written before
    // either vocabulary existed. `detail` is a plain log field: null for a
    // row built from an `EvaluationRecord`
    // (the engine's own `detail` was removed, ADR-0039, since it was a pure
    // function of `reason`); the one parameter a web-authored reason carries
    // (the engine error code, the dropped-session count, the collection
    // name), unprefixed, for a web-authored row; or the pre-#80 English
    // sentence a row already on disk carries from before either column
    // existed. Plain `text`, no CHECK, same as the sibling `outcome` column:
    // Zod (`evaluationReasonSchema` in `signals-repository.ts`) validates it
    // on read, so the closed vocabulary does not need a copy inside a
    // migration too.
    reason: text("reason"),
    detail: text("detail"),
    // Same pair as on `signals` (docs/adr/0047): which re-evaluation wrote
    // this row, and which one superseded it. `evaluations_append_only`
    // allows no other update.
    reevaluationId: text("reevaluation_id").references(() => signalReevaluations.id),
    supersededBy: text("superseded_by").references((): AnyPgColumn => signalReevaluations.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("evaluations_user_version_ticker_session_idx")
      .on(table.userId, table.strategyVersionId, table.ticker, table.session)
      .where(sql`${table.supersededBy} is null`),
    index("evaluations_user_id_strategy_id_idx").on(table.userId, table.strategyId),
  ],
);
