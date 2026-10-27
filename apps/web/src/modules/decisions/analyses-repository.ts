import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import {
  analysisInputsSchema,
  analysisObjectKindSchema,
  confidenceSchema,
  storedAnalysisOutputSchema,
  analysisOutlookClaimSchema,
  type AnalysisInputs,
  type AnalysisObjectKind,
  type AnalysisSubjectKind,
  type Confidence,
  type ResearchOutput,
  type SessionDate,
  type StoredAnalysisOutput,
  type AnalysisOutlookClaim,
} from "@fetha/contracts";

import type { Database, Transaction } from "@/db/client";
import { UserScopedRepository } from "@/lib/user-scoped-repository";

import type { AnalysisReason } from "./analysis-reason";
import { analysisRequests, analysisResults } from "./schema";

export const MONTHLY_ANALYSIS_CAP = 50;

// Thrown by `reserve` under the per-user advisory lock (docs/adr/0057,
// ADR-0032): this user's calendar-month count of requests whose result is
// not `failed` has already reached the cap.
export class AnalysisCapReachedError extends Error {
  constructor() {
    super("Monthly analysis cap reached");
    this.name = "AnalysisCapReachedError";
  }
}

export interface ReserveAnalysisInput {
  subjectKind: AnalysisSubjectKind;
  subjectId: string;
  inputs: AnalysisInputs;
  promptVersion: string;
  model: string;
}

export type AnalysisOutcome = "accepted" | "rejected" | "failed";

// An accepted outlook in the engine's own terms (docs/adr/0058), resolved
// before the result row is written.
export interface AnalysisClaim {
  claim: AnalysisOutlookClaim;
  confidence: Confidence;
  horizon: SessionDate;
}

export interface CompleteAnalysisInput {
  outcome: AnalysisOutcome;
  output: StoredAnalysisOutput | ResearchOutput | null;
  reason: AnalysisReason | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  claim?: AnalysisClaim | null;
}

export interface LatestAcceptedAnalysis {
  id: string;
  requestedAt: Date;
  promptVersion: string;
  model: string;
  output: StoredAnalysisOutput;
  inputs: AnalysisInputs;
}

// An accepted analysis as the journal lists it (docs/adr/0058).
export interface JournalAnalysis extends LatestAcceptedAnalysis {
  subjectKind: AnalysisObjectKind;
  subjectId: string;
  claim: AnalysisClaim | null;
}

const JOURNAL_ANALYSIS_LIMIT = 500;

export interface AnalysisUsage {
  used: number;
  cap: number;
}

function toLatestAccepted(row: {
  id: string;
  requestedAt: Date;
  promptVersion: string;
  model: string | null;
  output: unknown;
  inputs: unknown;
}): LatestAcceptedAnalysis {
  return {
    id: row.id,
    requestedAt: row.requestedAt,
    promptVersion: row.promptVersion,
    // `model` is never null on an accepted result (the output_xor_reason
    // check lets it be null only outside the `accepted` arm, and the
    // service only ever calls `complete` with a real answering model for
    // `accepted`), but the column itself stays nullable for `rejected`/
    // `failed` rows, so this reads the answering model back as a plain
    // string rather than re-deriving a non-null type at the schema level.
    model: row.model ?? "",
    output: storedAnalysisOutputSchema.parse(row.output),
    inputs: analysisInputsSchema.parse(row.inputs),
  };
}

function toAnalysisClaim(row: {
  claim: unknown;
  claimConfidence: string | null;
  horizon: string | null;
}): AnalysisClaim | null {
  if (row.claim === null || row.claimConfidence === null || row.horizon === null) {
    return null;
  }
  return {
    claim: analysisOutlookClaimSchema.parse(row.claim),
    confidence: confidenceSchema.parse(row.claimConfidence),
    horizon: row.horizon,
  };
}

// AI analyses are append-only and rate-capped per user (docs/adr/0057,
// #28): a request is reserved under the same per-user advisory lock
// pattern `BacktestRunRepository.enforceActiveCap` uses (ADR-0032), so two
// concurrent requests at the cap can never both pass.
export class AnalysesRepository extends UserScopedRepository {
  async reserve(input: ReserveAnalysisInput): Promise<{ id: string; requestedAt: Date }> {
    const inputs = analysisInputsSchema.parse(input.inputs);
    return this.db.transaction(async (tx) => {
      await this.lockUserScope(tx, "analysis_requests");
      const usage = await this.usageThisMonthLocked(tx);
      if (usage.used >= MONTHLY_ANALYSIS_CAP) {
        throw new AnalysisCapReachedError();
      }
      const [row] = await tx
        .insert(analysisRequests)
        .values({
          userId: this.userId,
          subjectKind: input.subjectKind,
          subjectId: input.subjectId,
          inputs,
          promptVersion: input.promptVersion,
          model: input.model,
        })
        .returning();
      if (!row) {
        throw new Error("failed to reserve analysis request");
      }
      return { id: row.id, requestedAt: row.requestedAt };
    });
  }

  // `executor` lets a caller write the result in a transaction of its own, so a research's rows
  // and its result land together or not at all (docs/adr/0076).
  async complete(
    requestId: string,
    result: CompleteAnalysisInput,
    executor: Database | Transaction = this.db,
  ): Promise<void> {
    await executor.insert(analysisResults).values({
      userId: this.userId,
      requestId,
      outcome: result.outcome,
      output: result.output,
      reason: result.reason,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      claim: result.claim?.claim ?? null,
      claimConfidence: result.claim?.confidence ?? null,
      horizon: result.claim?.horizon ?? null,
    });
  }

  async usageThisMonth(): Promise<AnalysisUsage> {
    return this.usageThisMonthLocked(this.db);
  }

  // A request with no result yet (the model call is still in flight, or was
  // killed by the platform before it could complete) counts only for its
  // first 5 minutes (docs/adr/0057): past that, it ages out of the count so
  // an orphaned reservation never holds a cap slot forever. A request with
  // a stored result counts exactly when that result is not `failed`.
  private async usageThisMonthLocked(executor: Database | Transaction): Promise<AnalysisUsage> {
    const [row] = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(analysisRequests)
      .leftJoin(analysisResults, eq(analysisResults.requestId, analysisRequests.id))
      .where(
        and(
          eq(analysisRequests.userId, this.userId),
          sql`date_trunc('month', ${analysisRequests.requestedAt} at time zone 'America/Sao_Paulo')
            = date_trunc('month', now() at time zone 'America/Sao_Paulo')`,
          or(
            sql`${analysisResults.outcome} is not null and ${analysisResults.outcome} <> 'failed'`,
            sql`${analysisResults.outcome} is null
              and ${analysisRequests.requestedAt} > now() - interval '5 minutes'`,
          ),
        ),
      );
    return { used: row?.count ?? 0, cap: MONTHLY_ANALYSIS_CAP };
  }

  async latestAccepted(
    subjectKind: AnalysisObjectKind,
    subjectIds: readonly string[],
  ): Promise<Map<string, LatestAcceptedAnalysis>> {
    if (subjectIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        id: analysisRequests.id,
        subjectId: analysisRequests.subjectId,
        requestedAt: analysisRequests.requestedAt,
        promptVersion: analysisRequests.promptVersion,
        model: analysisResults.model,
        output: analysisResults.output,
        inputs: analysisRequests.inputs,
      })
      .from(analysisRequests)
      .innerJoin(analysisResults, eq(analysisResults.requestId, analysisRequests.id))
      .where(
        and(
          eq(analysisRequests.userId, this.userId),
          eq(analysisRequests.subjectKind, subjectKind),
          inArray(analysisRequests.subjectId, [...subjectIds]),
          eq(analysisResults.outcome, "accepted"),
        ),
      )
      .orderBy(analysisRequests.requestedAt);

    const map = new Map<string, LatestAcceptedAnalysis>();
    for (const row of rows) {
      map.set(row.subjectId, toLatestAccepted(row));
    }
    return map;
  }

  // Every accepted analysis of this user, newest first, for the journal
  // (docs/adr/0058); rejected and failed requests are not analyses.
  async listAcceptedForJournal(): Promise<JournalAnalysis[]> {
    const rows = await this.db
      .select({
        id: analysisRequests.id,
        subjectKind: analysisRequests.subjectKind,
        subjectId: analysisRequests.subjectId,
        requestedAt: analysisRequests.requestedAt,
        promptVersion: analysisRequests.promptVersion,
        inputs: analysisRequests.inputs,
        model: analysisResults.model,
        output: analysisResults.output,
        claim: analysisResults.claim,
        claimConfidence: analysisResults.claimConfidence,
        horizon: analysisResults.horizon,
      })
      .from(analysisRequests)
      .innerJoin(
        analysisResults,
        and(
          eq(analysisResults.requestId, analysisRequests.id),
          eq(analysisResults.userId, this.userId),
        ),
      )
      .where(
        and(
          eq(analysisRequests.userId, this.userId),
          eq(analysisResults.outcome, "accepted"),
          // A research is not an analysis of one object: the journal shows it in its own panel
          // (docs/adr/0076).
          ne(analysisRequests.subjectKind, "research"),
        ),
      )
      .orderBy(desc(analysisRequests.requestedAt))
      .limit(JOURNAL_ANALYSIS_LIMIT);

    return rows.map((row) => ({
      ...toLatestAccepted(row),
      subjectKind: analysisObjectKindSchema.parse(row.subjectKind),
      subjectId: row.subjectId,
      claim: toAnalysisClaim(row),
    }));
  }
}
