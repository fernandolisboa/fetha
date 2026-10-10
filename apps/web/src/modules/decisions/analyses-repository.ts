import { and, eq, inArray, sql } from "drizzle-orm";
import {
  analysisInputsSchema,
  analysisOutputSchema,
  type AnalysisInputs,
  type AnalysisOutput,
  type AnalysisSubjectKind,
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

export interface CompleteAnalysisInput {
  outcome: AnalysisOutcome;
  output: AnalysisOutput | null;
  reason: AnalysisReason | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface LatestAcceptedAnalysis {
  id: string;
  requestedAt: Date;
  promptVersion: string;
  model: string;
  output: AnalysisOutput;
  inputs: AnalysisInputs;
}

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
    output: analysisOutputSchema.parse(row.output),
    inputs: analysisInputsSchema.parse(row.inputs),
  };
}

// AI analyses are append-only and rate-capped per user (docs/adr/0057,
// #28): a request is reserved under the same per-user advisory lock
// pattern `BacktestRunRepository.enforceActiveCap` uses (ADR-0032), so two
// concurrent requests at the cap can never both pass.
export class AnalysesRepository extends UserScopedRepository {
  async reserve(input: ReserveAnalysisInput): Promise<{ id: string }> {
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
      return { id: row.id };
    });
  }

  async complete(requestId: string, result: CompleteAnalysisInput): Promise<void> {
    await this.db.insert(analysisResults).values({
      userId: this.userId,
      requestId,
      outcome: result.outcome,
      output: result.output,
      reason: result.reason,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
  }

  async usageThisMonth(): Promise<AnalysisUsage> {
    return this.usageThisMonthLocked(this.db);
  }

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
          sql`${analysisResults.outcome} is distinct from 'failed'`,
        ),
      );
    return { used: row?.count ?? 0, cap: MONTHLY_ANALYSIS_CAP };
  }

  async latestAccepted(
    subjectKind: AnalysisSubjectKind,
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
}
