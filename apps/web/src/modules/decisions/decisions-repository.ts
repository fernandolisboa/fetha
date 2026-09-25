import { and, desc, eq, inArray } from "drizzle-orm";
import {
  confidenceSchema,
  costModelSchema,
  thesisClaimSchema,
  type Confidence,
  type CostModel,
  type SessionDate,
  type ThesisClaim,
} from "@fetha/contracts";
import { decisionKinds, type DecisionKind } from "@fetha/engine";

import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { journalOriginKinds, type JournalOriginKind } from "./allowed-kinds";
import { decisionInputsSchema, type DecisionInputs } from "./inputs";
import { classifyDecisionPersistenceError } from "./pg-error";
import { decisions } from "./schema";

export interface RecordDecisionInput {
  kind: DecisionKind;
  originKind: JournalOriginKind;
  signalId: string | null;
  contemplatedOperationId: string | null;
  operationId?: string | null;
  strategyVersionId: string | null;
  inputs: DecisionInputs;
  rationale: string;
  claim: ThesisClaim | null;
  confidence: Confidence;
  horizon: SessionDate;
  costModel: CostModel;
  // Overrides the column's own `defaultNow()` (#29 fix-web item 3): every
  // production caller (`actions.ts`) omits this and gets "now", the same as
  // before. The only caller that ever sets it is `seedE2EDecision`, backing
  // a fixed, already-ingested session so the E2E scoring flow does not
  // depend on the wall-clock date the suite happens to run on.
  decidedAt?: Date;
}

// Display names (strategy name, structure name) live inside `inputs`, not as
// top-level columns: they are snapshotted at record time (architecture
// review, round 2) rather than joined from `signals`/`strategies`/
// `contemplated_operations`, so every query here selects only from
// `decisions` — no other module's table is a schema-level FK reference
// away from being read directly, which ADR-0019 reserves for `schema.ts`
// foreign keys, not repository queries.
export interface DecisionListItem {
  id: string;
  kind: DecisionKind;
  originKind: JournalOriginKind;
  inputs: DecisionInputs;
  rationale: string;
  claim: ThesisClaim | null;
  confidence: Confidence;
  horizon: SessionDate;
  costModel: CostModel;
  decidedAt: Date;
  signalId: string | null;
  contemplatedOperationId: string | null;
  operationId: string | null;
}

// Thrown on the unique partial index over (user_id, signal_id): a signal is
// answered once (brief item 2).
export class DuplicateSignalDecisionError extends Error {
  constructor() {
    super("This signal already has a decision recorded against it");
    this.name = "DuplicateSignalDecisionError";
  }
}

// Thrown by the `decisions_horizon_on_or_after_decided_check` constraint:
// defense in depth behind `actions.ts`'s own pre-insert validation (a
// horizon that was valid when the form loaded but has since crossed into
// yesterday, or any caller that skips the action's check).
export class InvalidHorizonError extends Error {
  constructor() {
    super("The horizon cannot be before today");
    this.name = "InvalidHorizonError";
  }
}

const DECISION_KIND_VALUES = new Set<string>(decisionKinds);
function parseDecisionKind(value: string): DecisionKind {
  if (!DECISION_KIND_VALUES.has(value)) {
    throw new Error(`unknown decision kind: ${value}`);
  }
  return value as DecisionKind;
}

const JOURNAL_ORIGIN_KIND_VALUES: readonly string[] = journalOriginKinds;
function parseJournalOriginKind(value: string): JournalOriginKind {
  if (!JOURNAL_ORIGIN_KIND_VALUES.includes(value)) {
    throw new Error(`unknown decision origin kind: ${value}`);
  }
  return value as JournalOriginKind;
}

function toDecisionListItem(row: typeof decisions.$inferSelect): DecisionListItem {
  return {
    id: row.id,
    decidedAt: row.decidedAt,
    signalId: row.signalId,
    contemplatedOperationId: row.contemplatedOperationId,
    operationId: row.operationId,
    rationale: row.rationale,
    horizon: row.horizon,
    kind: parseDecisionKind(row.kind),
    originKind: parseJournalOriginKind(row.originKind),
    inputs: decisionInputsSchema.parse(row.inputs),
    claim: row.claim ? thesisClaimSchema.parse(row.claim) : null,
    confidence: confidenceSchema.parse(row.confidence),
    costModel: costModelSchema.parse(row.costModel),
  };
}

const JOURNAL_LIMIT = 500;

// Decisions are append-only (docs/adr/0005): this repository exposes only
// `record` and read methods. The database enforces the same invariant with
// the `decisions_no_update` trigger (0009_green_white_queen.sql), the same
// belt-and-suspenders pattern strategy_versions and backtest_runs use.
export class DecisionsRepository extends UserScopedRepository {
  async record(input: RecordDecisionInput): Promise<{ id: string }> {
    const inputs = decisionInputsSchema.parse(input.inputs);
    try {
      const [row] = await this.db
        .insert(decisions)
        .values({
          userId: this.userId,
          kind: input.kind,
          originKind: input.originKind,
          signalId: input.signalId,
          contemplatedOperationId: input.contemplatedOperationId,
          operationId: input.operationId ?? null,
          strategyVersionId: input.strategyVersionId,
          inputs,
          rationale: input.rationale,
          claim: input.claim,
          confidence: input.confidence,
          horizon: input.horizon,
          costModel: input.costModel,
          ...(input.decidedAt ? { decidedAt: input.decidedAt } : {}),
        })
        .returning();

      if (!row) {
        throw new Error("failed to record decision");
      }
      return { id: row.id };
    } catch (error) {
      const outcome = classifyDecisionPersistenceError(error);
      if (outcome === "duplicate_signal") {
        throw new DuplicateSignalDecisionError();
      }
      if (outcome === "invalid_horizon") {
        throw new InvalidHorizonError();
      }
      throw error;
    }
  }

  async listMine(): Promise<DecisionListItem[]> {
    const rows = await this.db
      .select()
      .from(decisions)
      .where(eq(decisions.userId, this.userId))
      .orderBy(desc(decisions.decidedAt), desc(decisions.createdAt))
      .limit(JOURNAL_LIMIT);

    return rows.map(toDecisionListItem);
  }

  // Whether this user has already answered a given page of signals
  // (SignalRow's own "answered" state, brief item 5), batched by id in one
  // query rather than the whole (capped) journal `listMine` returns — a
  // signal past `JOURNAL_LIMIT` in the journal must still show as answered
  // here. Scoped by user id the same way every other method here is, over
  // the same unique index `record` relies on.
  async findForSignals(signalIds: readonly string[]): Promise<Map<string, DecisionListItem>> {
    if (signalIds.length === 0) return new Map();

    const rows = await this.db
      .select()
      .from(decisions)
      .where(and(eq(decisions.userId, this.userId), inArray(decisions.signalId, [...signalIds])));

    const map = new Map<string, DecisionListItem>();
    for (const row of rows) {
      if (row.signalId !== null) {
        map.set(row.signalId, toDecisionListItem(row));
      }
    }
    return map;
  }

  // The most recent decision recorded against each of a page of
  // contemplated operations (the `/carteira` row's own "answered" state),
  // batched the same way `findForSignals` is. Unlike a signal, an
  // operation carries no uniqueness constraint on decisions (brief item 2
  // names only the signal partial index), so this keeps the latest one per
  // id: rows come back ordered newest first, so the first occurrence wins.
  async findLatestForOperations(
    contemplatedOperationIds: readonly string[],
  ): Promise<Map<string, DecisionListItem>> {
    if (contemplatedOperationIds.length === 0) return new Map();

    const rows = await this.db
      .select()
      .from(decisions)
      .where(
        and(
          eq(decisions.userId, this.userId),
          inArray(decisions.contemplatedOperationId, [...contemplatedOperationIds]),
        ),
      )
      .orderBy(desc(decisions.decidedAt), desc(decisions.createdAt));

    const map = new Map<string, DecisionListItem>();
    for (const row of rows) {
      if (row.contemplatedOperationId !== null && !map.has(row.contemplatedOperationId)) {
        map.set(row.contemplatedOperationId, toDecisionListItem(row));
      }
    }
    return map;
  }

  // The latest decision on each of a page of held operations, the same way:
  // a held operation takes a decision each time the user reassesses it.
  async findLatestForHeldOperations(
    operationIds: readonly string[],
  ): Promise<Map<string, DecisionListItem>> {
    if (operationIds.length === 0) return new Map();

    const rows = await this.db
      .select()
      .from(decisions)
      .where(
        and(eq(decisions.userId, this.userId), inArray(decisions.operationId, [...operationIds])),
      )
      .orderBy(desc(decisions.decidedAt), desc(decisions.createdAt));

    const map = new Map<string, DecisionListItem>();
    for (const row of rows) {
      if (row.operationId !== null && !map.has(row.operationId)) {
        map.set(row.operationId, toDecisionListItem(row));
      }
    }
    return map;
  }
}
