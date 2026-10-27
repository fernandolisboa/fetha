import {
  checkAnalysisCitations,
  checkAnalysisVerdict,
  resolveAnalysisOutlook,
  type AnalysisInputs,
  type AnalysisObjectKind,
  type AnalysisOutlookHorizon,
  type AnalysisSubjectKind,
  type ModelFamily,
  type SessionDate,
} from "@fetha/contracts";
import { analysisPrompt } from "@fetha/prompts";
import type { ZodType } from "zod";

import type { Database } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";

import { assembleAnalysisInputs, type AssembleAnalysisInputsResult } from "./analysis-inputs";
import { resolveOutlookHorizon } from "./analysis-horizon";
import type { AnalysisModelClient, AnalysisUsage } from "./analysis-model";
import type { AnalysisReason } from "./analysis-reason";
import {
  AnalysesRepository,
  AnalysisCapReachedError,
  type AnalysisClaim,
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

export interface AnalysisRepositoryPort {
  reserve: (input: ReserveAnalysisInput) => Promise<{ id: string; requestedAt: Date }>;
  complete: (requestId: string, result: CompleteAnalysisInput) => Promise<void>;
}

export interface RequestAnalysisDeps {
  db: Database;
  user: ScopedUser;
  client: AnalysisModelClient | null;
  // The id and family resolved by the caller (docs/adr/0068): the action
  // layer is the one with the user's own key and model-family choice, so
  // resolution happens there, not here.
  model: string;
  family: ModelFamily;
  onRejected?: (modelId: string) => void;
  // Injected for the unit tests this file's own test suite runs (CLAUDE.md
  // /tdd): the live default goes through each owning module's real
  // user-scoped query (docs/adr/0057's own ownership check), the fake used
  // by those tests exercises every branch below it without a database.
  assemble?: (
    subjectKind: AnalysisObjectKind,
    subjectId: string,
  ) => Promise<AssembleAnalysisInputsResult>;
  repository?: AnalysisRepositoryPort;
  resolveHorizon?: (
    horizon: AnalysisOutlookHorizon,
    requestedAt: Date,
  ) => Promise<SessionDate | null>;
}

export interface RequestAnalysisInput {
  subjectKind: AnalysisObjectKind;
  subjectId: string;
}

async function completeFailed(
  repository: AnalysisRepositoryPort,
  requestId: string,
  reason: AnalysisReason,
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

export async function completeRejected(
  repository: AnalysisRepositoryPort,
  requestId: string,
  reason: AnalysisReason,
  model: string,
  usage: AnalysisUsage,
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

export interface AnalysisContract<Output, Inputs extends AnalysisInputs> {
  version: string;
  system: string;
  render: (inputs: Inputs) => string;
  outputSchema: ZodType<Output>;
  maxOutputTokens?: number;
}

export interface AskUnderCapDeps {
  client: AnalysisModelClient;
  model: string;
  family: ModelFamily;
  onRejected?: (modelId: string) => void;
}

export type AskUnderCapResult<Output> =
  | { status: "cap_reached" | "rejected" | "failed" }
  | {
      status: "parsed";
      requestId: string;
      requestedAt: Date;
      output: Output;
      model: string;
      usage: AnalysisUsage;
    };

// ADR-0057's reservation and classification, shared by every contract that asks the model
// (a single object's analysis, a research's verdicts, docs/adr/0076): reserve a request under this
// user's monthly cap, call the model, and settle every outcome that is not a reply meeting the
// contract's schema (a refusal, a truncation, a missing reply, a schema failure) before handing
// the parsed reply back for the contract's own checks.
export async function askUnderCap<Output, Inputs extends AnalysisInputs>(
  deps: AskUnderCapDeps,
  repository: AnalysisRepositoryPort,
  request: { subjectKind: AnalysisSubjectKind; subjectId: string; inputs: Inputs },
  contract: AnalysisContract<Output, Inputs>,
): Promise<AskUnderCapResult<Output>> {
  let requestId: string;
  let requestedAt: Date;
  try {
    const reserved = await repository.reserve({
      subjectKind: request.subjectKind,
      subjectId: request.subjectId,
      inputs: request.inputs,
      promptVersion: contract.version,
      model: deps.model,
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
    model: deps.model,
    family: deps.family,
    system: contract.system,
    user: contract.render(request.inputs),
    outputSchema: contract.outputSchema,
    maxOutputTokens: contract.maxOutputTokens,
    onRejected: deps.onRejected,
  });

  if (reply.kind === "refusal") {
    await completeRejected(repository, requestId, { kind: "refusal" }, reply.model, reply.usage);
    return { status: "rejected" };
  }
  if (reply.kind === "incomplete") {
    await completeRejected(
      repository,
      requestId,
      { kind: "incomplete", stopReason: reply.stopReason },
      reply.model,
      reply.usage,
    );
    return { status: "rejected" };
  }
  if (reply.kind === "api_error") {
    await completeFailed(repository, requestId, { kind: "api_error", status: reply.status });
    return { status: "failed" };
  }

  const parsed = contract.outputSchema.safeParse(reply.output);
  if (!parsed.success) {
    await completeRejected(repository, requestId, { kind: "schema" }, reply.model, reply.usage);
    return { status: "rejected" };
  }
  return {
    status: "parsed",
    requestId,
    requestedAt,
    output: parsed.data,
    model: reply.model,
    usage: reply.usage,
  };
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

  const asked = await askUnderCap(
    { ...deps, client: deps.client },
    repository,
    { subjectKind: input.subjectKind, subjectId: input.subjectId, inputs: assembled.inputs },
    analysisPrompt,
  );
  if (asked.status !== "parsed") {
    return { status: asked.status };
  }
  const { requestId, requestedAt, output, model, usage } = asked;
  const reply = { model, usage };

  const citation = checkAnalysisCitations(assembled.inputs, output);
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

  const verdict = checkAnalysisVerdict(input.subjectKind, output);
  if (!verdict.ok) {
    await completeRejected(
      repository,
      requestId,
      { kind: "verdict", problem: verdict.problem },
      reply.model,
      reply.usage,
    );
    return { status: "rejected" };
  }

  let claim: AnalysisClaim | null = null;
  if (output.outlook !== null) {
    const outlook = resolveAnalysisOutlook(assembled.inputs, output.outlook);
    if (!outlook.ok) {
      await completeRejected(
        repository,
        requestId,
        { kind: "outlook", problem: outlook.problem },
        reply.model,
        reply.usage,
      );
      return { status: "rejected" };
    }
    // docs/adr/0058: a horizon the calendar cannot place leaves the
    // analysis accepted (its prose passed every check) but unscorable. A
    // failed lookup takes the same branch: the result row is append-only and
    // the paid reply would otherwise be lost with no result at all.
    const resolveHorizon =
      deps.resolveHorizon ??
      ((horizon: AnalysisOutlookHorizon, at: Date) => resolveOutlookHorizon(deps.db, horizon, at));
    const horizon = await resolveHorizon(outlook.horizon, requestedAt).catch(() => null);
    claim =
      horizon === null ? null : { claim: outlook.claim, confidence: outlook.confidence, horizon };
  }

  await repository.complete(requestId, {
    outcome: "accepted",
    output,
    reason: null,
    model: reply.model,
    inputTokens: reply.usage.inputTokens,
    outputTokens: reply.usage.outputTokens,
    claim,
  });
  return {
    status: "accepted",
    analysis: {
      id: requestId,
      requestedAt,
      promptVersion: analysisPrompt.version,
      model: reply.model,
      output,
      inputs: assembled.inputs,
    },
  };
}
