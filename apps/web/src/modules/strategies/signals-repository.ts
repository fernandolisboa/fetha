import { and, count, desc, eq, isNull } from "drizzle-orm";
import type { AdjustmentRule, ExitRule, Ticker } from "@fetha/contracts";
import type { EvaluationOutcome, IndicatorReading, Proposal, SignalKind } from "@fetha/engine";

import { evaluations, signals, strategies } from "@/db/schema";
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

// Owned by the strategies module (CONTEXT.md: "signal evaluation and the
// signal inbox"). The nightly cron constructs one instance per user it
// evaluates (never from a session), the inbox and evaluation-log screens
// construct one from the signed-in session (forCurrentUser): neither path
// accepts a user id as a method parameter.
export class SignalsRepository extends UserScopedRepository {
  async createSignals(rows: NewSignal[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
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
          operationId: row.operationId,
          rule: row.rule,
        })),
      )
      .onConflictDoNothing({
        target: [signals.userId, signals.strategyVersionId, signals.ticker, signals.session],
      })
      .returning({ id: signals.id });
    return inserted.length;
  }

  async createEvaluations(rows: NewEvaluation[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
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
      .onConflictDoNothing({
        target: [
          evaluations.userId,
          evaluations.strategyVersionId,
          evaluations.ticker,
          evaluations.session,
        ],
      })
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
      .orderBy(desc(signals.at))
      .limit(INBOX_LIMIT);

    return rows.map((row) => ({
      ...row,
      kind: row.kind as SignalKind,
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
      .orderBy(desc(evaluations.at))
      .limit(EVALUATION_LOG_LIMIT);

    return rows.map((row) => ({
      ...row,
      outcome: row.outcome as EvaluationOutcome,
    }));
  }
}
