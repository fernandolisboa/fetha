import Decimal from "decimal.js";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import type { Centavos, DecimalString } from "@fetha/contracts";
import type { DecisionKind, Score } from "@fetha/engine";

import { UserScopedRepository } from "@/lib/user-scoped-repository";

import { decisions, decisionScores } from "./schema";

// A scored row and an unscorable one are mutually exclusive (`score`/
// `unscorableReason`, schema.ts's own check constraint, #29 fix-web item 8):
// this union is the repository's own reflection of that constraint, so a
// caller can never construct a `NewDecisionScore` the database would reject.
export type NewDecisionScore =
  | {
      decisionId: string;
      score: Score;
      unscorableReason?: undefined;
      pnlCentavos: Centavos | null;
      maxLossCentavos: Centavos | null;
      maxLossUnbounded: boolean;
      normalizedPnl: DecimalString | null;
      claimHeld: boolean | null;
      brier: DecimalString | null;
      counterfactualPnlCentavos: Centavos | null;
      engineVersion: string;
    }
  | {
      decisionId: string;
      score?: undefined;
      unscorableReason: string;
      engineVersion: string;
    };

export interface DecisionScoreRow {
  id: string;
  decisionId: string;
  score: Score | null;
  unscorableReason: string | null;
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
    unscorableReason: row.unscorableReason,
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
  pnlOverTime: { horizon: string; normalizedPnl: DecimalString }[];
}

// Every write here carries the decision's own `user_id` (brief item 2): the
// nightly scoring job constructs this repository with `{ id: userId }` the
// same way `evaluateSignalsForSession` constructs `SignalsRepository`
// (evaluate-signals.ts) — never from an unscoped id a user-reachable path
// could pass in.
export class DecisionScoresRepository extends UserScopedRepository {
  // Idempotent by construction (brief item 1): `decision_scores_decision_id_idx`
  // is unique, so a decision already scored is silently skipped rather than
  // erroring, and a second run of the same night's job changes nothing. The
  // composite foreign key on `(decision_id, user_id)` (schema.ts) rejects
  // the write outright if `input.decisionId` belongs to a different user
  // than `this.userId` — the isolation guarantee this method's own
  // `userId: this.userId` alone could not make (#29 fix-web item 1).
  async insertIfAbsent(input: NewDecisionScore): Promise<{ inserted: boolean }> {
    const rows = await this.db
      .insert(decisionScores)
      .values({
        userId: this.userId,
        decisionId: input.decisionId,
        score: input.score ?? null,
        unscorableReason: input.unscorableReason ?? null,
        pnlCentavos: input.score ? input.pnlCentavos : null,
        maxLossCentavos: input.score ? input.maxLossCentavos : null,
        maxLossUnbounded: input.score ? input.maxLossUnbounded : false,
        normalizedPnl: input.score ? input.normalizedPnl : null,
        claimHeld: input.score ? input.claimHeld : null,
        brier: input.score ? input.brier : null,
        counterfactualPnlCentavos: input.score ? input.counterfactualPnlCentavos : null,
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
  // owe" shape. An unscorable row (score.ts null, `unscorableReason` set)
  // still counts as "has a score row" here — it is a terminal outcome, not a
  // pending one, so it is never picked up again.
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
  // covers the aggregation the same way it covers every read. Scoped twice
  // over the same user id — once on `decision_scores` itself, once on the
  // `decisions` side of the join (#29 fix-web item 1) — so a future join
  // rewrite that drops the first `WHERE` cannot silently widen this past one
  // tenant.
  async trackRecordStats(): Promise<TrackRecordStats> {
    const rows = await this.db
      .select({
        claimHeld: decisionScores.claimHeld,
        brier: decisionScores.brier,
        normalizedPnl: decisionScores.normalizedPnl,
        unscorableReason: decisionScores.unscorableReason,
        horizon: decisions.horizon,
        confidence: decisions.confidence,
        kind: decisions.kind,
      })
      .from(decisionScores)
      .innerJoin(
        decisions,
        and(eq(decisions.id, decisionScores.decisionId), eq(decisions.userId, this.userId)),
      )
      .where(eq(decisionScores.userId, this.userId))
      .orderBy(decisions.horizon);

    return computeTrackRecordStats(rows);
  }
}

interface TrackRecordSourceRow {
  claimHeld: boolean | null;
  brier: string | null;
  normalizedPnl: string | null;
  unscorableReason: string | null;
  horizon: string;
  confidence: string;
  kind: string;
}

const CONFIDENCE_BUCKET_WIDTH = 20;

// Bucketed on the integer percent (#29 fix-web item 7, quant+correctness
// BLOCKING): `confidence` is a decimal fraction in [0, 1] stored as a string
// (Confidence, @fetha/contracts), and bucketing the raw fraction with
// floating-point division/floor mis-buckets values like `0.59999999999999998`
// (a real `Number(decimalString)` artifact) into the bucket below the one its
// rounded percent belongs to. Rounding to the nearest integer percent first
// with `decimal.js` (CLAUDE.md: never a raw float for this) before bucketing
// removes that edge case; 100% is clamped into the top "80-100%" bucket
// rather than opening a degenerate single-value "100-120%" one.
function confidenceBucketLabel(confidence: string): string {
  const percent = Math.min(100, new Decimal(confidence).times(100).toDecimalPlaces(0).toNumber());
  const lower = Math.min(
    80,
    Math.floor(percent / CONFIDENCE_BUCKET_WIDTH) * CONFIDENCE_BUCKET_WIDTH,
  );
  const upper = lower + CONFIDENCE_BUCKET_WIDTH;
  return `${String(lower)}-${String(upper)}%`;
}

const DO_NOT_ENTER_KIND: DecisionKind = "do_not_enter";

export function computeTrackRecordStats(rows: TrackRecordSourceRow[]): TrackRecordStats {
  // Unscorable rows are a terminal non-outcome, not a claim miss or a P&L of
  // zero (#29 fix-web item 8): the track record only ever summarizes
  // decisions the engine actually scored.
  const scorable = rows.filter((row) => row.unscorableReason === null);

  const scoredCount = scorable.length;
  const claimRows = scorable.filter((row) => row.claimHeld !== null);
  const claimsScoredCount = claimRows.length;
  const claimsHeldCount = claimRows.filter((row) => row.claimHeld === true).length;

  const brierRows = scorable.filter(
    (row): row is TrackRecordSourceRow & { brier: string } => row.brier !== null,
  );
  const meanBrier =
    brierRows.length === 0
      ? null
      : brierRows
          .reduce((sum, row) => sum.plus(row.brier), new Decimal(0))
          .dividedBy(brierRows.length)
          .toFixed(4);

  const buckets = new Map<string, { count: number; heldCount: number }>();
  for (const row of claimRows) {
    const label = confidenceBucketLabel(row.confidence);
    const bucket = buckets.get(label) ?? { count: 0, heldCount: 0 };
    bucket.count += 1;
    if (row.claimHeld === true) bucket.heldCount += 1;
    buckets.set(label, bucket);
  }
  const confidenceBuckets = [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([bucket, stats]) => ({ bucket, count: stats.count, heldCount: stats.heldCount }));

  // Plotted by the decision's own resolved horizon, not `scoredAt` (#29
  // fix-web item 9): the scoring job can run days after a horizon actually
  // arrives (a missed cron night, a retried `insufficient_data` decision),
  // so `scoredAt` would misplace a point on the timeline relative to when
  // its outcome was actually due. `do_not_enter` decisions are excluded:
  // their `normalizedPnl` is always zero by rule (no operation to
  // normalize), so plotting them would only add a flat line of zeros with no
  // information in it.
  const pnlOverTime = scorable
    .filter((row) => row.kind !== DO_NOT_ENTER_KIND)
    .filter(
      (row): row is TrackRecordSourceRow & { normalizedPnl: string } => row.normalizedPnl !== null,
    )
    .map((row) => ({
      horizon: row.horizon,
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
