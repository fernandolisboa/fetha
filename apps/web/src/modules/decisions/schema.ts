import {
  pgTable,
  text,
  jsonb,
  timestamp,
  date,
  numeric,
  bigint,
  boolean,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { decisionKinds } from "@fetha/engine";
import type { CostModel, ThesisClaim } from "@fetha/contracts";
import type { Score } from "@fetha/engine";

import { user } from "../auth/schema";
import { signals, strategyVersions } from "../strategies/schema";
import { contemplatedOperations } from "../portfolio/schema";

import { journalOriginKinds } from "./allowed-kinds";
import type { DecisionInputs } from "./inputs";

// A user's explicit record about a signal or a contemplated operation
// (UBIQUITOUS_LANGUAGE.md "Decision"): append-only (enforced by the
// `decisions_no_update` trigger, hand-appended to the generated migration
// the same way strategy_versions and backtest_runs enforce their own
// invariants, drizzle-kit having no first-class trigger API). `signal_id`
// and `contemplated_operation_id` keep the database's default `no action`
// on delete rather than `set null` or `cascade`: neither the strategies nor
// the portfolio repository deletes a strategy, a signal or a contemplated
// operation today (only a user's own cascading deletion removes both the
// origin row and this one together), so a mutating `set null` — which would
// rewrite an append-only journal row — is never needed and never correct
// here.
export const decisions = pgTable(
  "decisions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    originKind: text("origin_kind").notNull(),
    signalId: text("signal_id").references(() => signals.id),
    contemplatedOperationId: text("contemplated_operation_id").references(
      () => contemplatedOperations.id,
    ),
    // Set for signal origin only (brief item 2): ScoreInput's DecisionOrigin
    // (packages/engine/src/api.ts) needs the strategy version to compute the
    // counterfactual (ADR-0014 Q40), and a contemplated operation has no
    // strategy version behind it.
    strategyVersionId: text("strategy_version_id").references(() => strategyVersions.id),
    inputs: jsonb("inputs").$type<DecisionInputs>().notNull(),
    rationale: text("rationale").notNull(),
    claim: jsonb("claim").$type<ThesisClaim | null>(),
    confidence: numeric("confidence", { mode: "string" }).notNull(),
    horizon: date("horizon", { mode: "string" }).notNull(),
    // The `b3_default` cost-model preset at decision time (backtests
    // module's default-config.ts), stored so the counterfactual (ADR-0014
    // Q40) always replays with the cost model the decision itself was taken
    // under, never today's default.
    costModel: jsonb("cost_model").$type<CostModel>().notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("decisions_user_id_decided_at_idx").on(table.userId, table.decidedAt),
    // A signal is answered once (brief item 2): partial so it constrains
    // only signal-origin rows, never contemplated-operation ones (whose
    // signal_id is always null).
    uniqueIndex("decisions_user_id_signal_id_idx")
      .on(table.userId, table.signalId)
      .where(sql`${table.signalId} is not null`),
    check(
      "decisions_kind_check",
      sql`${table.kind} in (${sql.raw(decisionKinds.map((kind) => `'${kind}'`).join(", "))})`,
    ),
    check(
      "decisions_origin_kind_check",
      sql`${table.originKind} in (${sql.raw(journalOriginKinds.map((kind) => `'${kind}'`).join(", "))})`,
    ),
    check(
      "decisions_origin_match_check",
      sql`(${table.originKind} = 'signal' and ${table.signalId} is not null and ${table.contemplatedOperationId} is null)
        or (${table.originKind} = 'contemplated_operation' and ${table.contemplatedOperationId} is not null and ${table.signalId} is null)`,
    ),
    check("decisions_rationale_not_blank_check", sql`length(trim(${table.rationale})) > 0`),
    check(
      "decisions_confidence_range_check",
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
    ),
    check(
      "decisions_horizon_on_or_after_decided_check",
      sql`${table.horizon} >= ((${table.decidedAt} at time zone 'America/Sao_Paulo')::date)`,
    ),
  ],
);

// A decision's engine-computed score (#29, ADR-0005 as amended by
// ADR-0014): append-only (enforced by the `decision_scores_no_update`
// trigger, the same hand-appended pattern `decisions_no_update` uses),
// exactly one row per decision (`decisionId` unique — the scoring job's own
// idempotent insert relies on this to make `ON CONFLICT DO NOTHING`
// correct). `score` is the full engine `Score` artifact; the other columns
// are the same fields extracted for the track record's server-side
// aggregations (hit rate, calibration, P&L over time) to filter and sum on
// without parsing jsonb in every query. Money stays integer centavos
// (CLAUDE.md); `maxLossUnbounded` carries the `"unbounded"` arm of the
// engine's `PnlScore` union that a nullable bigint column cannot express on
// its own.
export const decisionScores = pgTable(
  "decision_scores",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    decisionId: text("decision_id")
      .notNull()
      .references(() => decisions.id),
    score: jsonb("score").$type<Score>().notNull(),
    pnlCentavos: bigint("pnl_centavos", { mode: "number" }),
    maxLossCentavos: bigint("max_loss_centavos", { mode: "number" }),
    maxLossUnbounded: boolean("max_loss_unbounded").notNull().default(false),
    normalizedPnl: numeric("normalized_pnl", { mode: "string" }),
    claimHeld: boolean("claim_held"),
    brier: numeric("brier", { mode: "string" }),
    counterfactualPnlCentavos: bigint("counterfactual_pnl_centavos", { mode: "number" }),
    engineVersion: text("engine_version").notNull(),
    scoredAt: timestamp("scored_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("decision_scores_decision_id_idx").on(table.decisionId),
    index("decision_scores_user_id_scored_at_idx").on(table.userId, table.scoredAt),
  ],
);
