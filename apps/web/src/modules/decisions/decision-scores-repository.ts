import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import type { Centavos, DecimalString } from "@fetha/contracts";
import type { Score } from "@fetha/engine";

import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { decisions, decisionScores } from "./schema";

export interface NewDecisionScore {
  decisionId: string;
  score: Score;
  pnlCentavos: Centavos | null;
  maxLossCentavos: Centavos | null;
  maxLossUnbounded: boolean;
  normalizedPnl: DecimalString | null;
  claimHeld: boolean | null;
  brier: DecimalString | null;
  counterfactualPnlCentavos: Centavos | null;
  engineVersion: string;
}

export interface DecisionScoreRow {
  id: string;
  decisionId: string;
  score: Score;
  pnlCentavos: Centavos | null;
  maxLossCentavos: Centavos | null;
  maxLossUnbounded: boolean;
  normalizedPnl: DecimalString | null;
  claimHeld: boolean | null;
  brier: DecimalString | null;
  counterfactualPnlCentavos: Centavos | null;
  engineVersion: string;
  scoredAt: Date;
}

// A decision due for scoring: the fields `score-input.ts` needs to build a
// `ScoreInput`, read from the same append-only `decisions` row `listMine`
// reads, scoped by this user the same way (isolation, brief item 5).
export interface DueDecisionRow {
  id: string;
  kind: (typeof decisions.$inferSelect)["kind"];
  originKind: (typeof decisions.$inferSelect)["originKind"];
  inputs: (typeof decisions.$inferSelect)["inputs"];
  claim: (typeof decisions.$inferSelect)["claim"];
  confidence: (typeof decisions.$inferSelect)["confidence"];
  horizon: (typeof decisions.$inferSelect)["horizon"];
  costModel: (typeof decisions.$inferSelect)["costModel"];
  decidedAt: Date;
  strategyVersionId: string | null;
}

function toDecisionScoreRow(row: typeof decisionScores.$inferSelect): DecisionScoreRow {
  return {
    id: row.id,
    decisionId: row.decisionId,
    score: row.score,
    pnlCentavos: row.pnlCentavos as Centavos | null,
    maxLossCentavos: row.maxLossCentavos as Centavos | null,
    maxLossUnbounded: row.maxLossUnbounded,
    normalizedPnl: row.normalizedPnl as DecimalString | null,
    claimHeld: row.claimHeld,
    brier: row.brier as DecimalString | null,
    counterfactualPnlCentavos: row.counterfactualPnlCentavos as Centavos | null,
    engineVersion: row.engineVersion,
    scoredAt: row.scoredAt,
  };
}

export interface TrackRecordStats {
  scoredCount: number;
  claimsScoredCount: number;
  claimsHeldCount: number;
  meanBrier: DecimalString | null;
  confidenceBuckets: { bucket: string; count: number; heldCount: number }[];
  pnlOverTime: { scoredAt: Date; normalizedPnl: DecimalString }[];
}

// Every write here carries the decision's own `user_id` (brief item 2): the
// nightly scoring job constructs this repository with `{ id: userId }` the
// same way `evaluateSignalsForSession` constructs `SignalsRepository`
// (evaluate-signals.ts) — never from an unscoped id a user-reachable path
// could pass in.
export class DecisionScoresRepository extends UserScopedRepository {
  // Idempotent by construction (brief item 1): `decision_scores_decision_id_idx`
  // is unique, so a decision already scored is silently skipped rather than
  // erroring, and a second run of the same night's job changes nothing.
  async insertIfAbsent(input: NewDecisionScore): Promise<{ inserted: boolean }> {
    const rows = await this.db
      .insert(decisionScores)
      .values({
        userId: this.userId,
        decisionId: input.decisionId,
        score: input.score,
        pnlCentavos: input.pnlCentavos,
        maxLossCentavos: input.maxLossCentavos,
        maxLossUnbounded: input.maxLossUnbounded,
        normalizedPnl: input.normalizedPnl,
        claimHeld: input.claimHeld,
        brier: input.brier,
        counterfactualPnlCentavos: input.counterfactualPnlCentavos,
        engineVersion: input.engineVersion,
      })
      .onConflictDoNothing({ target: decisionScores.decisionId })
      .returning({ id: decisionScores.id });
    return { inserted: rows.length > 0 };
  }

  // Every decision belonging to this user whose horizon has arrived
  // (`horizon <= asOfSession`, the latest ingested session) and that has no
  // score row yet: the scoring job's per-user due list, mirroring
  // `SignalsRepository.lastEvaluatedSession`'s "what does this user still
  // owe" shape.
  async dueForUser(asOfSession: string): Promise<DueDecisionRow[]> {
    const rows = await this.db
      .select({
        id: decisions.id,
        kind: decisions.kind,
        originKind: decisions.originKind,
        inputs: decisions.inputs,
        claim: decisions.claim,
        confidence: decisions.confidence,
        horizon: decisions.horizon,
        costModel: decisions.costModel,
        decidedAt: decisions.decidedAt,
        strategyVersionId: decisions.strategyVersionId,
      })
      .from(decisions)
      .leftJoin(decisionScores, eq(decisionScores.decisionId, decisions.id))
      .where(
        and(
          eq(decisions.userId, this.userId),
          lte(decisions.horizon, asOfSession),
          isNull(decisionScores.id),
        ),
      )
      .orderBy(decisions.decidedAt);

    return rows;
  }

  async listMine(): Promise<DecisionScoreRow[]> {
    const rows = await this.db
      .select()
      .from(decisionScores)
      .where(eq(decisionScores.userId, this.userId));
    return rows.map(toDecisionScoreRow);
  }

  async findForDecisions(decisionIds: readonly string[]): Promise<Map<string, DecisionScoreRow>> {
    if (decisionIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(decisionScores)
      .where(
        and(
          eq(decisionScores.userId, this.userId),
          inArray(decisionScores.decisionId, [...decisionIds]),
        ),
      );
    return new Map(rows.map((row) => [row.decisionId, toDecisionScoreRow(row)]));
  }

  // Server-side aggregations for the track record panel (brief item 4): hit
  // rate, calibration (mean Brier + stated-confidence buckets vs realized
  // hit rate) and normalized P&L over time. Computed here, scoped by this
  // user, rather than in the page component, so the isolation guarantee
  // covers the aggregation the same way it covers every read.
  async trackRecordStats(): Promise<TrackRecordStats> {
    const rows = await this.db
      .select({
        claimHeld: decisionScores.claimHeld,
        brier: decisionScores.brier,
        normalizedPnl: decisionScores.normalizedPnl,
        scoredAt: decisionScores.scoredAt,
        confidence: decisions.confidence,
      })
      .from(decisionScores)
      .innerJoin(decisions, eq(decisions.id, decisionScores.decisionId))
      .where(eq(decisionScores.userId, this.userId))
      .orderBy(decisionScores.scoredAt);

    return computeTrackRecordStats(rows);
  }
}

interface TrackRecordSourceRow {
  claimHeld: boolean | null;
  brier: string | null;
  normalizedPnl: string | null;
  scoredAt: Date;
  confidence: string;
}

const CONFIDENCE_BUCKET_WIDTH = 0.2;

function confidenceBucketLabel(confidence: number): string {
  const lower = Math.min(
    0.8,
    Math.floor(confidence / CONFIDENCE_BUCKET_WIDTH) * CONFIDENCE_BUCKET_WIDTH,
  );
  const upper = lower + CONFIDENCE_BUCKET_WIDTH;
  return `${String(Math.round(lower * 100))}-${String(Math.round(upper * 100))}%`;
}

export function computeTrackRecordStats(rows: TrackRecordSourceRow[]): TrackRecordStats {
  const scoredCount = rows.length;
  const claimRows = rows.filter((row) => row.claimHeld !== null);
  const claimsScoredCount = claimRows.length;
  const claimsHeldCount = claimRows.filter((row) => row.claimHeld === true).length;

  const brierRows = rows.filter(
    (row): row is TrackRecordSourceRow & { brier: string } => row.brier !== null,
  );
  const meanBrier =
    brierRows.length === 0
      ? null
      : (brierRows.reduce((sum, row) => sum + Number(row.brier), 0) / brierRows.length).toFixed(4);

  const buckets = new Map<string, { count: number; heldCount: number }>();
  for (const row of claimRows) {
    const label = confidenceBucketLabel(Number(row.confidence));
    const bucket = buckets.get(label) ?? { count: 0, heldCount: 0 };
    bucket.count += 1;
    if (row.claimHeld === true) bucket.heldCount += 1;
    buckets.set(label, bucket);
  }
  const confidenceBuckets = [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([bucket, stats]) => ({ bucket, count: stats.count, heldCount: stats.heldCount }));

  const pnlOverTime = rows
    .filter(
      (row): row is TrackRecordSourceRow & { normalizedPnl: string } => row.normalizedPnl !== null,
    )
    .map((row) => ({
      scoredAt: row.scoredAt,
      normalizedPnl: row.normalizedPnl as DecimalString,
    }));

  return {
    scoredCount,
    claimsScoredCount,
    claimsHeldCount,
    meanBrier: meanBrier as DecimalString | null,
    confidenceBuckets,
    pnlOverTime,
  };
}
