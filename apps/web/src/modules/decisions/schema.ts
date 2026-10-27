import {
  pgTable,
  text,
  jsonb,
  timestamp,
  date,
  numeric,
  bigint,
  boolean,
  integer,
  uniqueIndex,
  index,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { decisionKinds } from "@fetha/engine";
import { analysisVerdicts } from "@fetha/contracts";
import type {
  AnalysisOutlookClaim,
  CostModel,
  ResearchAlert,
  ResearchOutput,
  ThesisClaim,
} from "@fetha/contracts";
import type { AssetReading, OperationPricing, Score } from "@fetha/engine";

import { user } from "../auth/schema";
import { signals, strategyVersions } from "../strategies/schema";
import { contemplatedOperations, operations } from "../portfolio/schema";
import type { DropReason, IdeaAlert, LotLeg } from "@/modules/radar";
import { suggestions } from "../radar/schema";

import {
  analysisSubjectKinds,
  type AnalysisInputs,
  type StoredAnalysisOutput,
} from "@fetha/contracts";

import { journalOriginKinds } from "./allowed-kinds";
import type { AnalysisReason } from "./analysis-reason";
import type { DecisionInputs } from "./inputs";

// A user's explicit record about a signal, a contemplated operation, a
// held operation or a suggestion (UBIQUITOUS_LANGUAGE.md "Decision"): append-only (enforced by the
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
    // A held operation of the real portfolio (ADR-0022 item 2). Its composite
    // foreign key below binds it to this row's own user, and with the
    // default `no action` on delete it is also why an operation with
    // decisions can no longer be ungrouped.
    operationId: text("operation_id"),
    // Set for signal origin only (brief item 2): ScoreInput's DecisionOrigin
    // (packages/engine/src/api.ts) needs the strategy version to compute the
    // counterfactual (ADR-0014 Q40), and a contemplated operation has no
    // strategy version behind it.
    strategyVersionId: text("strategy_version_id").references(() => strategyVersions.id),
    // A suggestion is shared reference data (docs/adr/0067), so a plain foreign key: the decision
    // is the user's, the suggestion every user's. `no action` on delete for the same reason as
    // `signal_id` above: the radar never rewrites a suggestion once an underlying is read.
    suggestionId: text("suggestion_id").references(() => suggestions.id),
    // A stored idea of Fetha's research (docs/adr/0076): the user's own row, so the composite
    // foreign key below binds it to this decision's user. `no action` on delete, like the others.
    researchIdeaId: text("research_idea_id"),
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
    // A suggestion is answered once per user, like a signal (docs/adr/0067).
    uniqueIndex("decisions_user_id_suggestion_id_idx")
      .on(table.userId, table.suggestionId)
      .where(sql`${table.suggestionId} is not null`),
    // An idea is answered once per user, like a suggestion (docs/adr/0076).
    uniqueIndex("decisions_user_id_research_idea_id_idx")
      .on(table.userId, table.researchIdeaId)
      .where(sql`${table.researchIdeaId} is not null`),
    foreignKey({
      name: "decisions_research_idea_id_user_id_fk",
      columns: [table.researchIdeaId, table.userId],
      foreignColumns: [researchIdeas.id, researchIdeas.userId],
    }),
    // Not a business constraint (the primary key already makes `id` unique
    // on its own): Postgres requires a unique constraint on exactly the
    // referenced column set before `decision_scores`' composite foreign key
    // below can target `(id, user_id)`. That composite FK is the security
    // invariant this index exists for: a score row's
    // `user_id` is bound to its `decision_id`'s own `user_id` at the
    // database level, so `insertIfAbsent` can never attach one user's score
    // to another user's decision even if a caller passed a foreign
    // `decisionId` by mistake.
    uniqueIndex("decisions_id_user_id_idx").on(table.id, table.userId),
    index("decisions_user_id_operation_id_idx").on(table.userId, table.operationId),
    foreignKey({
      columns: [table.operationId, table.userId],
      foreignColumns: [operations.id, operations.userId],
    }),
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
      sql`(${table.originKind} = 'signal' and ${table.signalId} is not null and ${table.contemplatedOperationId} is null and ${table.operationId} is null and ${table.suggestionId} is null and ${table.researchIdeaId} is null)
        or (${table.originKind} = 'contemplated_operation' and ${table.contemplatedOperationId} is not null and ${table.signalId} is null and ${table.operationId} is null and ${table.suggestionId} is null and ${table.researchIdeaId} is null)
        or (${table.originKind} = 'held_operation' and ${table.operationId} is not null and ${table.signalId} is null and ${table.contemplatedOperationId} is null and ${table.suggestionId} is null and ${table.researchIdeaId} is null)
        or (${table.originKind} = 'suggestion' and ${table.suggestionId} is not null and ${table.signalId} is null and ${table.contemplatedOperationId} is null and ${table.operationId} is null and ${table.researchIdeaId} is null)
        or (${table.originKind} = 'research_idea' and ${table.researchIdeaId} is not null and ${table.signalId} is null and ${table.contemplatedOperationId} is null and ${table.operationId} is null and ${table.suggestionId} is null)`,
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
// its own. `score`/`unscorableReason` are mutually exclusive: a decision
// the engine can never score (a non-retriable engine
// error, a build failure that cannot heal, or `insufficient_data` that has
// outlived its retry window) still gets exactly one terminal row, with
// `score` null and `unscorableReason` naming why, so `dueForUser`'s
// left-join-on-`decision_scores` still treats it as answered and the
// nightly job never retries it forever.
export const decisionScores = pgTable(
  "decision_scores",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    decisionId: text("decision_id").notNull(),
    score: jsonb("score").$type<Score>(),
    unscorableReason: text("unscorable_reason"),
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
    // Composite FK, not the plain `decisionId -> decisions.id` this replaces:
    // it binds this row's own
    // `user_id` to the `user_id` of the decision it scores, at the database
    // level, over `decisions_id_user_id_idx` above. A write that names a
    // real `decisionId` but the wrong `userId` (an isolation break, not a
    // legitimate reference) is now a foreign-key violation, not a silently
    // accepted row a `WHERE user_id = ...` read would have hidden.
    foreignKey({
      columns: [table.decisionId, table.userId],
      foreignColumns: [decisions.id, decisions.userId],
    }),
    check(
      "decision_scores_score_xor_unscorable_check",
      sql`(${table.score} is not null and ${table.unscorableReason} is null)
        or (${table.score} is null and ${table.unscorableReason} is not null)`,
    ),
  ],
);

// One request for an AI analysis (ADR-0057, #28): user-scoped, append-only
// (enforced by `analysis_requests_no_update`, the same hand-appended
// pattern `decisions_no_update` uses). `subject_id` carries no foreign key:
// the four possible subjects (signals, contemplated operations, operations,
// backtest runs) live in four different tables, and ownership is already
// checked at request time through each owning module's own user-scoped
// query (`analysis-inputs.ts`) before this row is ever inserted — a second,
// unscoped FK here would add nothing a cross-table constraint could
// enforce anyway. The unique `(id, user_id)` index exists only so
// `analysis_results`' composite foreign key below can bind a result to
// this row's own user at the database level.
export const analysisRequests = pgTable(
  "analysis_requests",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    subjectKind: text("subject_kind").notNull(),
    subjectId: text("subject_id").notNull(),
    inputs: jsonb("inputs").$type<AnalysisInputs>().notNull(),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("analysis_requests_user_id_requested_at_idx").on(table.userId, table.requestedAt),
    index("analysis_requests_user_id_subject_idx").on(
      table.userId,
      table.subjectKind,
      table.subjectId,
    ),
    uniqueIndex("analysis_requests_id_user_id_idx").on(table.id, table.userId),
    check(
      "analysis_requests_subject_kind_check",
      sql`${table.subjectKind} in (${sql.raw(analysisSubjectKinds.map((kind) => `'${kind}'`).join(", "))})`,
    ),
  ],
);

// The outcome of one request (ADR-0057): user-scoped, append-only (same
// `_no_update` trigger pattern), exactly one row per request (`request_id`
// unique). The composite foreign key binds this row's own `user_id` to the
// `user_id` of the request it answers, over `analysis_requests_id_user_id_idx`
// above, so a result can never be attached to another user's request even
// if a caller passed a foreign `requestId` by mistake. `output`/`reason`
// are mutually exclusive: `accepted` always carries an output and no
// reason, `rejected`/`failed` always carry a reason and no output — a
// rejected reply's text is never stored (docs/adr/0057), only why it was
// discarded. `model` is nullable: a `failed` call (no reply at all, an API
// error) never reached a model that answered. `claim`, `claim_confidence`
// and `horizon` (docs/adr/0058) are the accepted outlook resolved into the
// engine's terms at acceptance, written in the same insert: all set or all
// null, and only ever on an accepted row.
export const analysisResults = pgTable(
  "analysis_results",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull().unique(),
    outcome: text("outcome").notNull(),
    output: jsonb("output").$type<StoredAnalysisOutput | ResearchOutput | null>(),
    reason: jsonb("reason").$type<AnalysisReason | null>(),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    claim: jsonb("claim").$type<AnalysisOutlookClaim | null>(),
    claimConfidence: numeric("claim_confidence", { mode: "string" }),
    horizon: date("horizon", { mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("analysis_results_user_id_completed_at_idx").on(table.userId, table.completedAt),
    foreignKey({
      name: "analysis_results_request_id_user_id_fk",
      columns: [table.requestId, table.userId],
      foreignColumns: [analysisRequests.id, analysisRequests.userId],
    }),
    check(
      "analysis_results_outcome_check",
      sql`${table.outcome} in ('accepted', 'rejected', 'failed')`,
    ),
    check(
      "analysis_results_output_xor_reason_check",
      sql`(${table.outcome} = 'accepted' and ${table.output} is not null and ${table.reason} is null)
        or (${table.outcome} <> 'accepted' and ${table.output} is null and ${table.reason} is not null)`,
    ),
    check(
      "analysis_results_claim_all_or_none_check",
      sql`(${table.claim} is null and ${table.claimConfidence} is null and ${table.horizon} is null)
        or (${table.outcome} = 'accepted' and ${table.claim} is not null
          and ${table.claimConfidence} is not null and ${table.horizon} is not null)`,
    ),
    check(
      "analysis_results_claim_confidence_range_check",
      sql`${table.claimConfidence} >= 0 and ${table.claimConfidence} <= 1`,
    ),
  ],
);

// An accepted analysis's engine-computed score (docs/adr/0058): the same
// shape and rules as `decision_scores`, one append-only row per request
// (`analysis_scores_no_update` trigger, `request_id` unique), either the
// engine's `Score` or a terminal `unscorable_reason`. The composite foreign
// key binds this row's own `user_id` to the request's, over
// `analysis_requests_id_user_id_idx`, so a score can never be attached to
// another user's analysis.
export const analysisScores = pgTable(
  "analysis_scores",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    score: jsonb("score").$type<Score>(),
    unscorableReason: text("unscorable_reason"),
    claimHeld: boolean("claim_held"),
    brier: numeric("brier", { mode: "string" }),
    engineVersion: text("engine_version").notNull(),
    scoredAt: timestamp("scored_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("analysis_scores_request_id_idx").on(table.requestId),
    index("analysis_scores_user_id_scored_at_idx").on(table.userId, table.scoredAt),
    foreignKey({
      name: "analysis_scores_request_id_user_id_fk",
      columns: [table.requestId, table.userId],
      foreignColumns: [analysisRequests.id, analysisRequests.userId],
    }),
    check(
      "analysis_scores_score_xor_unscorable_check",
      sql`(${table.score} is not null and ${table.unscorableReason} is null)
        or (${table.score} is null and ${table.unscorableReason} is not null)`,
    ),
  ],
);

// The id is drawn before the request is reserved and doubles as that request's `subject_id`.
export const suggestionResearches = pgTable(
  "suggestion_researches",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    analysisRequestId: text("analysis_request_id").notNull(),
    newestClose: date("newest_close", { mode: "string" }).notNull(),
    sessionsLooked: integer("sessions_looked").notNull(),
    candidates: integer("candidates").notNull(),
    dropped: jsonb("dropped").$type<Record<DropReason, number>>().notNull(),
    usingDefaultProfile: boolean("using_default_profile").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("suggestion_researches_user_id_created_at_idx").on(table.userId, table.createdAt),
    uniqueIndex("suggestion_researches_id_user_id_idx").on(table.id, table.userId),
    uniqueIndex("suggestion_researches_analysis_request_id_idx").on(table.analysisRequestId),
    foreignKey({
      name: "suggestion_researches_request_id_user_id_fk",
      columns: [table.analysisRequestId, table.userId],
      foreignColumns: [analysisRequests.id, analysisRequests.userId],
    }),
    check(
      "suggestion_researches_counts_check",
      sql`${table.sessionsLooked} >= 0 and ${table.candidates} >= 0`,
    ),
  ],
);

// `newest_close` repeats the research's so the horizon check can live in the table.
export const researchIdeas = pgTable(
  "research_ideas",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    researchId: text("research_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    underlying: text("underlying").notNull(),
    recipeId: text("recipe_id").notNull(),
    foundOn: date("found_on", { mode: "string" }).notNull(),
    // The suggestion the radar filed this finding as, when it did; shared reference data.
    suggestionId: text("suggestion_id").references(() => suggestions.id),
    newestClose: date("newest_close", { mode: "string" }).notNull(),
    sessionsToExpiry: integer("sessions_to_expiry").notNull(),
    legs: jsonb("legs").$type<LotLeg[]>().notNull(),
    pricing: jsonb("pricing").$type<OperationPricing>().notNull(),
    reading: jsonb("reading").$type<AssetReading>().notNull(),
    engineAlerts: jsonb("engine_alerts").$type<IdeaAlert[]>().notNull(),
    verdict: text("verdict").notNull(),
    justification: text("justification").notNull(),
    aiAlerts: jsonb("ai_alerts").$type<ResearchAlert[]>().notNull(),
    inputsCited: jsonb("inputs_cited").$type<string[]>().notNull(),
    claim: jsonb("claim").$type<ThesisClaim>().notNull(),
    horizon: date("horizon", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("research_ideas_research_id_position_idx").on(table.researchId, table.position),
    uniqueIndex("research_ideas_id_user_id_idx").on(table.id, table.userId),
    index("research_ideas_user_id_horizon_idx").on(table.userId, table.horizon),
    foreignKey({
      name: "research_ideas_research_id_user_id_fk",
      columns: [table.researchId, table.userId],
      foreignColumns: [suggestionResearches.id, suggestionResearches.userId],
    }),
    check("research_ideas_position_check", sql`${table.position} >= 0`),
    check(
      "research_ideas_verdict_check",
      sql`${table.verdict} in (${sql.raw(analysisVerdicts.map((verdict) => `'${verdict}'`).join(", "))})`,
    ),
    check("research_ideas_horizon_after_close_check", sql`${table.horizon} > ${table.newestClose}`),
  ],
);

export const researchIdeaScores = pgTable(
  "research_idea_scores",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ideaId: text("idea_id").notNull(),
    score: jsonb("score").$type<Score>(),
    unscorableReason: text("unscorable_reason"),
    claimHeld: boolean("claim_held"),
    pnlCentavos: bigint("pnl_centavos", { mode: "number" }),
    maxLossCentavos: bigint("max_loss_centavos", { mode: "number" }),
    normalizedPnl: numeric("normalized_pnl", { mode: "string" }),
    engineVersion: text("engine_version").notNull(),
    scoredAt: timestamp("scored_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("research_idea_scores_idea_id_idx").on(table.ideaId),
    index("research_idea_scores_user_id_scored_at_idx").on(table.userId, table.scoredAt),
    foreignKey({
      name: "research_idea_scores_idea_id_user_id_fk",
      columns: [table.ideaId, table.userId],
      foreignColumns: [researchIdeas.id, researchIdeas.userId],
    }),
    check(
      "research_idea_scores_score_xor_unscorable_check",
      sql`(${table.score} is not null and ${table.unscorableReason} is null)
        or (${table.score} is null and ${table.unscorableReason} is not null)`,
    ),
  ],
);
