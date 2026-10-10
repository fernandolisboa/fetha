import { analysisOutputSchema, checkAnalysisCitations } from "@fetha/contracts";
import { analysisModels, analysisPrompt } from "@fetha/prompts";

import type { Database } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";

import { assembleAnalysisInputs, type AssembleAnalysisInputsResult } from "./analysis-inputs";
import type { AnalysisModelClient } from "./analysis-model";
import {
  AnalysesRepository,
  AnalysisCapReachedError,
  type CompleteAnalysisInput,
  type LatestAcceptedAnalysis,
  type ReserveAnalysisInput,
} from "./analyses-repository";

export type AcceptedAnalysisView = LatestAcceptedAnalysis;

export type RequestAnalysisResult =
  | { status: "unavailable" }
  | { status: "not_found" }
  | { status: "not_ready" }
  | { status: "cap_reached" }
  | { status: "accepted"; analysis: AcceptedAnalysisView }
  | { status: "rejected" }
  | { status: "failed" };

interface AnalysisRepositoryPort {
  reserve: (input: ReserveAnalysisInput) => Promise<{ id: string; requestedAt: Date }>;
  complete: (requestId: string, result: CompleteAnalysisInput) => Promise<void>;
}

export interface RequestAnalysisDeps {
  db: Database;
  user: ScopedUser;
  client: AnalysisModelClient | null;
  // Injected for the unit tests this file's own test suite runs (CLAUDE.md
  // /tdd): the live default goes through each owning module's real
  // user-scoped query (docs/adr/0057's own ownership check), the fake used
  // by those tests exercises every branch below it without a database.
  assemble?: (
    subjectKind: Parameters<typeof assembleAnalysisInputs>[0],
    subjectId: string,
  ) => Promise<AssembleAnalysisInputsResult>;
  repository?: AnalysisRepositoryPort;
}

export interface RequestAnalysisInput {
  subjectKind: Parameters<typeof assembleAnalysisInputs>[0];
  subjectId: string;
}

async function completeFailed(
  repository: AnalysisRepositoryPort,
  requestId: string,
  reason: CompleteAnalysisInput["reason"],
): Promise<void> {
  await repository.complete(requestId, {
    outcome: "failed",
    output: null,
    reason,
    model: null,
    inputTokens: null,
    outputTokens: null,
  });
}

async function completeRejected(
  repository: AnalysisRepositoryPort,
  requestId: string,
  reason: CompleteAnalysisInput["reason"],
  model: string,
  usage: { inputTokens: number; outputTokens: number },
): Promise<void> {
  await repository.complete(requestId, {
    outcome: "rejected",
    output: null,
    reason,
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });
}

// ADR-0057's own pipeline: a null client answers `unavailable` before
// anything is reserved; everything else assembles the subject's facts
// (through the owning module's own ownership check), reserves a request
// under this user's monthly cap, calls the model, then classifies the
// reply against the output contract and the citation check before ever
// storing it as accepted.
export async function requestAnalysis(
  deps: RequestAnalysisDeps,
  input: RequestAnalysisInput,
): Promise<RequestAnalysisResult> {
  if (!deps.client) {
    return { status: "unavailable" };
  }

  const assemble = deps.assemble ?? assembleAnalysisInputs;
  const assembled = await assemble(input.subjectKind, input.subjectId);
  if (!assembled.ok) {
    return { status: assembled.reason };
  }

  const repository: AnalysisRepositoryPort =
    deps.repository ?? new AnalysesRepository(deps.db, deps.user);
  const model = analysisModels[input.subjectKind];

  let requestId: string;
  let requestedAt: Date;
  try {
    const reserved = await repository.reserve({
      subjectKind: input.subjectKind,
      subjectId: input.subjectId,
      inputs: assembled.inputs,
      promptVersion: analysisPrompt.version,
      model,
    });
    requestId = reserved.id;
    requestedAt = reserved.requestedAt;
  } catch (error) {
    if (error instanceof AnalysisCapReachedError) {
      return { status: "cap_reached" };
    }
    throw error;
  }

  const reply = await deps.client.analyze({
    model,
    system: analysisPrompt.system,
    user: analysisPrompt.render(assembled.inputs),
  });

  if (reply.kind === "refusal") {
    await completeFailed(repository, requestId, { kind: "refusal" });
    return { status: "failed" };
  }
  if (reply.kind === "max_tokens") {
    await completeFailed(repository, requestId, { kind: "max_tokens" });
    return { status: "failed" };
  }
  if (reply.kind === "api_error") {
    await completeFailed(repository, requestId, { kind: "api_error", status: reply.status });
    return { status: "failed" };
  }

  const parsed = analysisOutputSchema.safeParse(reply.output);
  if (!parsed.success) {
    await completeRejected(repository, requestId, { kind: "schema" }, reply.model, reply.usage);
    return { status: "rejected" };
  }

  const citation = checkAnalysisCitations(assembled.inputs, parsed.data);
  if (!citation.ok) {
    await completeRejected(
      repository,
      requestId,
      {
        kind: "citation",
        uncitedFigures: citation.uncitedFigures,
        unknownPaths: citation.unknownPaths,
      },
      reply.model,
      reply.usage,
    );
    return { status: "rejected" };
  }

  await repository.complete(requestId, {
    outcome: "accepted",
    output: parsed.data,
    reason: null,
    model: reply.model,
    inputTokens: reply.usage.inputTokens,
    outputTokens: reply.usage.outputTokens,
  });
  return {
    status: "accepted",
    analysis: {
      id: requestId,
      requestedAt,
      promptVersion: analysisPrompt.version,
      model: reply.model,
      output: parsed.data,
      inputs: assembled.inputs,
    },
  };
}
