import { and, asc, count, desc, eq, isNull, max } from "drizzle-orm";
import { z } from "zod";
import {
  adjustmentRuleSchema,
  exitRuleSchema,
  type AdjustmentRule,
  type ExitRule,
  type Ticker,
} from "@fetha/contracts";
import {
  evaluationOutcomes,
  signalKinds,
  type EvaluationOutcome,
  type IndicatorReading,
  type Proposal,
  type SignalKind,
} from "@fetha/engine";

import { evaluations, signals, strategies, NO_OPERATION_ID } from "@/db/schema";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

export interface NewSignal {
  strategyId: string;
  strategyVersionId: string;
  ticker: Ticker;
  timeframe: string;
  session: string;
  at: Date;
  kind: SignalKind;
  indicators: IndicatorReading[];
  proposal: Proposal | null;
  operationId: string | null;
  rule: ExitRule | AdjustmentRule | null;
}

export interface NewEvaluation {
  strategyId: string;
  strategyVersionId: string;
  ticker: Ticker;
  session: string;
  at: Date;
  outcome: EvaluationOutcome;
  detail: string | null;
}

export interface SignalListItem {
  id: string;
  strategyId: string;
  strategyName: string;
  strategyVersionId: string;
  ticker: Ticker;
  timeframe: string;
  session: string;
  at: Date;
  kind: SignalKind;
  indicators: IndicatorReading[];
  proposal: Proposal | null;
  operationId: string | null;
  rule: ExitRule | AdjustmentRule | null;
  readAt: Date | null;
}

export interface EvaluationLogItem {
  id: string;
  strategyId: string;
  strategyName: string;
  ticker: Ticker;
  session: string;
  at: Date;
  outcome: EvaluationOutcome;
  detail: string | null;
}

const INBOX_LIMIT = 200;
const EVALUATION_LOG_LIMIT = 200;

const signalKindSchema = z.enum(signalKinds);
const evaluationOutcomeSchema = z.enum(evaluationOutcomes);
const signalRuleSchema = z.union([exitRuleSchema, adjustmentRuleSchema]).nullable();

function toStoredOperationId(operationId: string | null): string {
  return operationId ?? NO_OPERATION_ID;
}

function fromStoredOperationId(operationId: string): string | null {
  return operationId === NO_OPERATION_ID ? null : operationId;
}

// Owned by the strategies module (CONTEXT.md: "signal evaluation and the
// signal inbox"). The nightly cron constructs one instance per user it
// evaluates (never from a session), the inbox and evaluation-log screens
// construct one from the signed-in session (forCurrentUser): neither path
// accepts a user id as a method parameter.
export class SignalsRepository extends UserScopedRepository {
  // Idempotent insert only: a session already written once for a given
  // (user, strategy version, ticker, session[, kind, operation]) is left
  // alone. There is no update or delete path over `signals` or
  // `evaluations` — see issue #84 for the append-only supersession design
  // that will let a corrected candle actually revise a stored result.
  async createSignals(rows: NewSignal[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    const target = [
      signals.userId,
      signals.strategyVersionId,
      signals.ticker,
      signals.session,
      signals.kind,
      signals.operationId,
    ];
    const inserted = await this.db
      .insert(signals)
      .values(
        rows.map((row) => ({
          userId: this.userId,
          strategyId: row.strategyId,
          strategyVersionId: row.strategyVersionId,
          ticker: row.ticker,
          timeframe: row.timeframe,
          session: row.session,
          at: row.at,
          kind: row.kind,
          indicators: row.indicators,
          proposal: row.proposal,
          operationId: toStoredOperationId(row.operationId),
          rule: row.rule,
        })),
      )
      .onConflictDoNothing({ target })
      .returning({ id: signals.id });
    return inserted.length;
  }

  async createEvaluations(rows: NewEvaluation[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    const target = [
      evaluations.userId,
      evaluations.strategyVersionId,
      evaluations.ticker,
      evaluations.session,
    ];
    const inserted = await this.db
      .insert(evaluations)
      .values(
        rows.map((row) => ({
          userId: this.userId,
          strategyId: row.strategyId,
          strategyVersionId: row.strategyVersionId,
          ticker: row.ticker,
          session: row.session,
          at: row.at,
          outcome: row.outcome,
          detail: row.detail,
        })),
      )
      .onConflictDoNothing({ target })
      .returning({ id: evaluations.id });
    return inserted.length;
  }

  async listInbox(): Promise<SignalListItem[]> {
    const rows = await this.db
      .select({
        id: signals.id,
        strategyId: signals.strategyId,
        strategyName: strategies.name,
        strategyVersionId: signals.strategyVersionId,
        ticker: signals.ticker,
        timeframe: signals.timeframe,
        session: signals.session,
        at: signals.at,
        kind: signals.kind,
        indicators: signals.indicators,
        proposal: signals.proposal,
        operationId: signals.operationId,
        rule: signals.rule,
        readAt: signals.readAt,
      })
      .from(signals)
      .innerJoin(strategies, eq(strategies.id, signals.strategyId))
      .where(eq(signals.userId, this.userId))
      .orderBy(desc(signals.at), desc(signals.createdAt), asc(signals.ticker), asc(signals.id))
      .limit(INBOX_LIMIT);

    return rows.map((row) => ({
      ...row,
      kind: signalKindSchema.parse(row.kind),
      rule: signalRuleSchema.parse(row.rule),
      operationId: fromStoredOperationId(row.operationId),
    }));
  }

  async unreadCount(): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(signals)
      .where(and(eq(signals.userId, this.userId), isNull(signals.readAt)));
    return row?.value ?? 0;
  }

  async markRead(signalId: string): Promise<void> {
    await this.db
      .update(signals)
      .set({ readAt: new Date() })
      .where(and(eq(signals.id, signalId), eq(signals.userId, this.userId)));
  }

  // This user's own watermark for the nightly evaluation, scoped to one
  // strategy version (#19 round 3 item 1): the newest session this user has
  // ever actually been evaluated for *under this strategy version*, not
  // across every strategy. The unit of work is (strategy version, session),
  // so a watermark shared across a user's strategies let a partial
  // completion in one strategy's loop advance past sessions a sibling
  // strategy never saw. `session` is fixed-width ISO-8601 date text
  // (`sessionDateSchema`), not a `date` column, so `MAX` sorts it correctly
  // lexicographically without a timestamp tie-break.
  // `evaluateSignalsForSession` anchors `since` on this, per strategy inside
  // its loop, instead of the ingestion calendar or a per-user watermark, so
  // a night one strategy was skipped (a setup failure, a deadline, a thrown
  // error in a sibling strategy) is caught up on the next run instead of
  // silently lost.
  async lastEvaluatedSession(strategyVersionId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ session: max(evaluations.session) })
      .from(evaluations)
      .where(
        and(
          eq(evaluations.userId, this.userId),
          eq(evaluations.strategyVersionId, strategyVersionId),
        ),
      );
    return row?.session ?? null;
  }

  async listEvaluationLog(): Promise<EvaluationLogItem[]> {
    const rows = await this.db
      .select({
        id: evaluations.id,
        strategyId: evaluations.strategyId,
        strategyName: strategies.name,
        ticker: evaluations.ticker,
        session: evaluations.session,
        at: evaluations.at,
        outcome: evaluations.outcome,
        detail: evaluations.detail,
      })
      .from(evaluations)
      .innerJoin(strategies, eq(strategies.id, evaluations.strategyId))
      .where(eq(evaluations.userId, this.userId))
      .orderBy(
        desc(evaluations.at),
        desc(evaluations.createdAt),
        asc(evaluations.ticker),
        asc(evaluations.id),
      )
      .limit(EVALUATION_LOG_LIMIT);

    return rows.map((row) => ({
      ...row,
      outcome: evaluationOutcomeSchema.parse(row.outcome),
    }));
  }
}
