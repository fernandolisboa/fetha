import {
  checkResearchCitations,
  checkResearchIdeas,
  type AnalysisInputs,
  type ModelFamily,
  type ResearchOutput,
  type SessionDate,
} from "@fetha/contracts";
import { researchPrompt } from "@fetha/prompts";

import type { Database } from "@/db/client";
import { safeDbErrorMessage } from "@/db/pg-error";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { suggestionClaim, type DropReason, type Idea } from "@/modules/radar";

import type { AnalysisModelClient } from "./analysis-model";
import { askUnderCap, completeRejected, type AnalysisRepositoryPort } from "./analysis-service";
import { AnalysesRepository, type CompleteAnalysisInput } from "./analyses-repository";
import { assembleResearchInputs } from "./research-inputs";
import { ResearchRepository, type NewResearch, type NewResearchIdea } from "./research-repository";

export type RequestResearchResult =
  | { status: "unavailable" | "not_ready" | "cap_reached" | "rejected" | "failed" }
  | { status: "accepted"; researchId: string };

export interface ResearchStorePort {
  storeAccepted: (input: {
    completion: CompleteAnalysisInput;
    research: NewResearch;
    ideas: readonly NewResearchIdea[];
  }) => Promise<void>;
}

export interface RequestResearchDeps {
  db: Database;
  user: ScopedUser;
  client: AnalysisModelClient | null;
  model: string;
  family: ModelFamily;
  onRejected?: (modelId: string) => void;
  now?: Date;
  // The latest instant (`clock()` ms) the model call may still start at, so that a call already
  // paid for is never cut short by the platform's own limit (docs/adr/0076).
  mustStartBy?: number;
  clock?: () => number;
  assemble?: (input: {
    newestClose: SessionDate;
    ideas: readonly Idea[];
    now: Date;
  }) => Promise<{ ok: true; inputs: AnalysisInputs } | { ok: false }>;
  repository?: AnalysisRepositoryPort;
  store?: ResearchStorePort;
  newId?: () => string;
}

export interface RequestResearchInput {
  newestClose: SessionDate;
  sessionsLooked: number;
  candidates: number;
  dropped: Record<DropReason, number>;
  usingDefaultProfile: boolean;
  // The ideas to send, in the order they are shown: `ideas.<n>` of the facts is the nth.
  ideas: readonly Idea[];
}

function positionOf(path: string): number {
  return Number(path.slice("ideas.".length));
}

function newIdeaOf(
  idea: Idea,
  position: number,
  answer: ResearchOutput["ideas"][number],
): NewResearchIdea {
  return {
    position,
    underlying: idea.underlying,
    recipeId: idea.recipeId,
    foundOn: idea.foundOn,
    suggestionId: idea.suggestionId,
    sessionsToExpiry: idea.sessionsToExpiry,
    legs: idea.legs,
    pricing: idea.pricing,
    reading: idea.reading,
    engineAlerts: idea.alerts,
    verdict: answer.verdict,
    justification: answer.justification,
    aiAlerts: answer.alerts,
    inputsCited: answer.inputsCited,
    claim: suggestionClaim(idea.pricing),
    horizon: idea.expiry,
  };
}

// One analysis per research (docs/adr/0076): ADR-0057's reservation, cap and classification, then
// the checks of `research@1`. A reply is accepted only if it answers every idea sent exactly
// once and every figure of its prose is a figure of the facts; the research and its ideas are
// stored in the same transaction as the result row.
export async function requestResearch(
  deps: RequestResearchDeps,
  input: RequestResearchInput,
): Promise<RequestResearchResult> {
  if (!deps.client) return { status: "unavailable" };
  if (input.ideas.length === 0) return { status: "not_ready" };

  const now = deps.now ?? new Date();
  const assemble = deps.assemble ?? ((args) => assembleResearchInputs(deps.db, args));
  const assembled = await assemble({ newestClose: input.newestClose, ideas: input.ideas, now });
  if (!assembled.ok) return { status: "not_ready" };
  if (deps.mustStartBy !== undefined && (deps.clock ?? Date.now)() > deps.mustStartBy) {
    return { status: "failed" };
  }

  const repository: AnalysisRepositoryPort =
    deps.repository ?? new AnalysesRepository(deps.db, deps.user);
  const researchId = (deps.newId ?? (() => crypto.randomUUID()))();

  const asked = await askUnderCap(
    { ...deps, client: deps.client },
    repository,
    { subjectKind: "research", subjectId: researchId, inputs: assembled.inputs },
    researchPrompt,
  );
  if (asked.status !== "parsed") return { status: asked.status };
  const { requestId, output, model, usage } = asked;

  const coverage = checkResearchIdeas(assembled.inputs, output);
  if (!coverage.ok) {
    await completeRejected(
      repository,
      requestId,
      { kind: "research_ideas", problem: coverage.problem },
      model,
      usage,
    );
    return { status: "rejected" };
  }
  const citation = checkResearchCitations(assembled.inputs, output);
  if (!citation.ok) {
    await completeRejected(
      repository,
      requestId,
      {
        kind: "citation",
        uncitedFigures: citation.uncitedFigures,
        unknownPaths: citation.unknownPaths,
      },
      model,
      usage,
    );
    return { status: "rejected" };
  }

  const ideas = output.ideas
    .map((answer) => {
      const position = positionOf(answer.idea);
      const idea = input.ideas[position];
      return idea ? newIdeaOf(idea, position, answer) : null;
    })
    .filter((idea): idea is NewResearchIdea => idea !== null)
    .sort((a, b) => a.position - b.position);

  const store = deps.store ?? new ResearchRepository(deps.db, deps.user);
  try {
    await store.storeAccepted({
      completion: {
        outcome: "accepted",
        output,
        reason: null,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        claim: null,
      },
      research: {
        id: researchId,
        analysisRequestId: requestId,
        newestClose: input.newestClose,
        sessionsLooked: input.sessionsLooked,
        candidates: input.candidates,
        dropped: input.dropped,
        usingDefaultProfile: input.usingDefaultProfile,
      },
      ideas,
    });
  } catch (error) {
    console.error("requestResearch storage failed", safeDbErrorMessage(error));
    // The transaction left no result row, so the paid reply is settled as rejected: it still
    // counts toward the cap, and the user sees the engine's numbers alone.
    await completeRejected(repository, requestId, { kind: "storage" }, model, usage);
    return { status: "rejected" };
  }
  return { status: "accepted", researchId };
}
