import Decimal from "decimal.js";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import {
  analysisLikelihoods,
  confidenceSchema,
  analysisOutlookClaimSchema,
  outlookOf,
  type AnalysisLikelihood,
  type Confidence,
  type DecimalString,
  type AnalysisOutlookClaim,
} from "@fetha/contracts";
import type { Score } from "@fetha/engine";

import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { analysisRequests, analysisResults, analysisScores } from "./schema";

// Scored and unscorable rows are mutually exclusive (`analysis_scores`'
// own check constraint), mirrored here as `NewDecisionScore` mirrors
// `decision_scores`.
export type NewAnalysisScore =
  | {
      requestId: string;
      score: Score;
      unscorableReason?: undefined;
      claimHeld: boolean | null;
      brier: DecimalString | null;
      engineVersion: string;
    }
  | {
      requestId: string;
      score?: undefined;
      unscorableReason: string;
      engineVersion: string;
    };

export interface AnalysisScoreRow {
  requestId: string;
  unscorableReason: string | null;
  claimHeld: boolean | null;
  brier: DecimalString | null;
  scoredAt: Date;
}

// An accepted analysis whose outlook's horizon has arrived and that has no
// score row yet (docs/adr/0058).
export interface DueAnalysisRow {
  requestId: string;
  requestedAt: Date;
  claim: AnalysisOutlookClaim;
  confidence: Confidence;
  horizon: string;
}

export interface AnalysisTrackRecordStats {
  scoredCount: number;
  claimsHeldCount: number;
  meanBrier: DecimalString | null;
  likelihoodBuckets: { likelihood: AnalysisLikelihood; count: number; heldCount: number }[];
}

// Every write carries the analysis's own `user_id`: the nightly job builds
// this repository with `{ id: userId }` from `dueAnalysisUserIds`, the same
// way `DecisionScoresRepository` is built, never from an id a user-reachable
// path could pass in. The composite foreign key on `(request_id, user_id)`
// rejects a score naming another user's request.
export class AnalysisScoresRepository extends UserScopedRepository {
  async insertIfAbsent(input: NewAnalysisScore): Promise<{ inserted: boolean }> {
    const rows = await this.db
      .insert(analysisScores)
      .values({
        userId: this.userId,
        requestId: input.requestId,
        score: input.score ?? null,
        unscorableReason: input.unscorableReason ?? null,
        claimHeld: input.score ? input.claimHeld : null,
        brier: input.score ? input.brier : null,
        engineVersion: input.engineVersion,
      })
      .onConflictDoNothing({ target: analysisScores.requestId })
      .returning({ id: analysisScores.id });
    return { inserted: rows.length > 0 };
  }

  async dueForUser(asOfSession: string): Promise<DueAnalysisRow[]> {
    const rows = await this.db
      .select({
        requestId: analysisRequests.id,
        requestedAt: analysisRequests.requestedAt,
        claim: analysisResults.claim,
        claimConfidence: analysisResults.claimConfidence,
        horizon: analysisResults.horizon,
      })
      .from(analysisResults)
      .innerJoin(
        analysisRequests,
        and(
          eq(analysisRequests.id, analysisResults.requestId),
          eq(analysisRequests.userId, this.userId),
        ),
      )
      .leftJoin(analysisScores, eq(analysisScores.requestId, analysisResults.requestId))
      .where(
        and(
          eq(analysisResults.userId, this.userId),
          eq(analysisResults.outcome, "accepted"),
          lte(analysisResults.horizon, asOfSession),
          isNull(analysisScores.id),
        ),
      )
      .orderBy(analysisRequests.requestedAt);

    return rows.flatMap((row) =>
      row.claim === null || row.claimConfidence === null || row.horizon === null
        ? []
        : [
            {
              requestId: row.requestId,
              requestedAt: row.requestedAt,
              claim: analysisOutlookClaimSchema.parse(row.claim),
              confidence: confidenceSchema.parse(row.claimConfidence),
              horizon: row.horizon,
            },
          ],
    );
  }

  async findForRequests(requestIds: readonly string[]): Promise<Map<string, AnalysisScoreRow>> {
    if (requestIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        requestId: analysisScores.requestId,
        unscorableReason: analysisScores.unscorableReason,
        claimHeld: analysisScores.claimHeld,
        brier: analysisScores.brier,
        scoredAt: analysisScores.scoredAt,
      })
      .from(analysisScores)
      .where(
        and(
          eq(analysisScores.userId, this.userId),
          inArray(analysisScores.requestId, [...requestIds]),
        ),
      );
    return new Map(
      rows.map((row) => [row.requestId, { ...row, brier: row.brier as DecimalString | null }]),
    );
  }

  // The "AI calibration" panel (docs/adr/0058), kept apart from the
  // decisions' track record. Scoped on both sides of the join, as
  // `DecisionScoresRepository.trackRecordStats` is.
  async trackRecordStats(): Promise<AnalysisTrackRecordStats> {
    const rows = await this.db
      .select({
        claimHeld: analysisScores.claimHeld,
        brier: analysisScores.brier,
        output: analysisResults.output,
      })
      .from(analysisScores)
      .innerJoin(
        analysisResults,
        and(
          eq(analysisResults.requestId, analysisScores.requestId),
          eq(analysisResults.userId, this.userId),
        ),
      )
      .where(eq(analysisScores.userId, this.userId));

    return computeAnalysisTrackRecordStats(
      rows.map(({ output, ...row }) => ({
        ...row,
        likelihood: output ? (outlookOf(output)?.likelihood ?? null) : null,
      })),
    );
  }
}

interface AnalysisTrackRecordSourceRow {
  claimHeld: boolean | null;
  brier: string | null;
  likelihood: AnalysisLikelihood | null;
}

// Only rows the engine scored count: an unscorable row has no claim outcome.
export function computeAnalysisTrackRecordStats(
  rows: readonly AnalysisTrackRecordSourceRow[],
): AnalysisTrackRecordStats {
  const scored = rows.filter(
    (row): row is AnalysisTrackRecordSourceRow & { claimHeld: boolean; brier: string } =>
      row.claimHeld !== null && row.brier !== null,
  );
  const meanBrier =
    scored.length === 0
      ? null
      : (scored
          .reduce((sum, row) => sum.plus(row.brier), new Decimal(0))
          .dividedBy(scored.length)
          .toFixed(4) as DecimalString);

  const likelihoodBuckets = analysisLikelihoods.flatMap((likelihood) => {
    const inBucket = scored.filter((row) => row.likelihood === likelihood);
    return inBucket.length === 0
      ? []
      : [
          {
            likelihood,
            count: inBucket.length,
            heldCount: inBucket.filter((row) => row.claimHeld).length,
          },
        ];
  });

  return {
    scoredCount: scored.length,
    claimsHeldCount: scored.filter((row) => row.claimHeld).length,
    meanBrier,
    likelihoodBuckets,
  };
}
