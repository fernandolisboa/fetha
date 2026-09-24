import { and, desc, eq } from "drizzle-orm";
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

import type { Database } from "@/db/client";
import { UserScopedRepository } from "@/lib/user-scoped-repository";
import { contemplatedOperations } from "../portfolio/schema";
import { signals, strategies, structures } from "../strategies/schema";

import { decisions } from "./schema";
import { decisionInputsSchema, type DecisionInputs } from "./inputs";
import type { DecisionOriginKind } from "./allowed-kinds";

export interface RecordDecisionInput {
  kind: DecisionKind;
  originKind: DecisionOriginKind;
  signalId: string | null;
  contemplatedOperationId: string | null;
  strategyVersionId: string | null;
  inputs: DecisionInputs;
  rationale: string;
  claim: ThesisClaim | null;
  confidence: Confidence;
  horizon: SessionDate;
  costModel: CostModel;
}

export interface DecisionListItem {
  id: string;
  kind: DecisionKind;
  originKind: DecisionOriginKind;
  inputs: DecisionInputs;
  rationale: string;
  claim: ThesisClaim | null;
  confidence: Confidence;
  horizon: SessionDate;
  costModel: CostModel;
  decidedAt: Date;
  signalId: string | null;
  strategyName: string | null;
  ticker: string | null;
  contemplatedOperationId: string | null;
  structureName: string | null;
  underlying: string | null;
}

// Thrown on the unique partial index over (user_id, signal_id): a signal is
// answered once (brief item 2).
export class DuplicateSignalDecisionError extends Error {
  constructor() {
    super("This signal already has a decision recorded against it");
    this.name = "DuplicateSignalDecisionError";
  }
}

interface PgDriverError {
  code: string;
  severity: string;
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error instanceof Error && "cause" in error ? error.cause : error;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "code" in candidate &&
    "severity" in candidate &&
    (candidate as PgDriverError).code === "23505"
  );
}

const DECISION_KIND_VALUES = new Set<string>(decisionKinds);
function parseDecisionKind(value: string): DecisionKind {
  if (!DECISION_KIND_VALUES.has(value)) {
    throw new Error(`unknown decision kind: ${value}`);
  }
  return value as DecisionKind;
}

const DECISION_ORIGIN_KIND_VALUES: readonly DecisionOriginKind[] = [
  "signal",
  "contemplated_operation",
];
function parseDecisionOriginKind(value: string): DecisionOriginKind {
  if (!DECISION_ORIGIN_KIND_VALUES.includes(value as DecisionOriginKind)) {
    throw new Error(`unknown decision origin kind: ${value}`);
  }
  return value as DecisionOriginKind;
}

// The one row shape both read methods below select and map: a decision
// joined out to the strategy/ticker or structure/underlying its origin
// names in the journal (DESIGN.md JournalEntry), the same left-join-both-
// origins shape for either method since exactly one side is ever non-null
// (the `decisions_origin_match_check` constraint).
function decisionRows(db: Database) {
  return db
    .select({
      id: decisions.id,
      kind: decisions.kind,
      originKind: decisions.originKind,
      inputs: decisions.inputs,
      rationale: decisions.rationale,
      claim: decisions.claim,
      confidence: decisions.confidence,
      horizon: decisions.horizon,
      costModel: decisions.costModel,
      decidedAt: decisions.decidedAt,
      signalId: decisions.signalId,
      strategyName: strategies.name,
      ticker: signals.ticker,
      contemplatedOperationId: decisions.contemplatedOperationId,
      structureName: structures.name,
      underlying: contemplatedOperations.underlying,
    })
    .from(decisions)
    .leftJoin(signals, eq(signals.id, decisions.signalId))
    .leftJoin(strategies, eq(strategies.id, signals.strategyId))
    .leftJoin(
      contemplatedOperations,
      eq(contemplatedOperations.id, decisions.contemplatedOperationId),
    )
    .leftJoin(structures, eq(structures.id, contemplatedOperations.structureId));
}

type DecisionRow = Awaited<ReturnType<typeof decisionRows>>[number];

function toDecisionListItem(row: DecisionRow): DecisionListItem {
  return {
    id: row.id,
    decidedAt: row.decidedAt,
    signalId: row.signalId,
    strategyName: row.strategyName,
    ticker: row.ticker,
    contemplatedOperationId: row.contemplatedOperationId,
    structureName: row.structureName,
    underlying: row.underlying,
    rationale: row.rationale,
    horizon: row.horizon,
    kind: parseDecisionKind(row.kind),
    originKind: parseDecisionOriginKind(row.originKind),
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
    try {
      const [row] = await this.db
        .insert(decisions)
        .values({
          userId: this.userId,
          kind: input.kind,
          originKind: input.originKind,
          signalId: input.signalId,
          contemplatedOperationId: input.contemplatedOperationId,
          strategyVersionId: input.strategyVersionId,
          inputs: input.inputs,
          rationale: input.rationale,
          claim: input.claim,
          confidence: input.confidence,
          horizon: input.horizon,
          costModel: input.costModel,
        })
        .returning({ id: decisions.id });

      if (!row) {
        throw new Error("failed to record decision");
      }
      return { id: row.id };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateSignalDecisionError();
      }
      throw error;
    }
  }

  async listMine(): Promise<DecisionListItem[]> {
    const rows = await decisionRows(this.db)
      .where(eq(decisions.userId, this.userId))
      .orderBy(desc(decisions.decidedAt), desc(decisions.createdAt))
      .limit(JOURNAL_LIMIT);

    return rows.map(toDecisionListItem);
  }

  // Whether this user has already answered a given signal (SignalRow's own
  // "answered" state, brief item 5): scoped by user id the same way every
  // other method here is, over the same unique index `record` relies on.
  async findForSignal(signalId: string): Promise<DecisionListItem | null> {
    const [row] = await decisionRows(this.db).where(
      and(eq(decisions.userId, this.userId), eq(decisions.signalId, signalId)),
    );

    return row ? toDecisionListItem(row) : null;
  }

  // The most recent decision recorded against a contemplated operation
  // (the `/carteira` row's own "answered" state): unlike a signal, an
  // operation carries no uniqueness constraint on decisions (brief item 2
  // names only the signal partial index), so this reads the latest one.
  async findLatestForOperation(contemplatedOperationId: string): Promise<DecisionListItem | null> {
    const [row] = await decisionRows(this.db)
      .where(
        and(
          eq(decisions.userId, this.userId),
          eq(decisions.contemplatedOperationId, contemplatedOperationId),
        ),
      )
      .orderBy(desc(decisions.decidedAt), desc(decisions.createdAt))
      .limit(1);

    return row ? toDecisionListItem(row) : null;
  }
}
