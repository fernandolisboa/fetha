"use server";

import { revalidatePath } from "next/cache";
import { sessionDateSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { resolveAnalysisModelForCurrentUser } from "@/modules/ai-models";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  forCurrentUser,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";
import {
  ideaCardOf,
  newestReadSession,
  researchSuggestionsAction,
  type IdeaCard,
  type ResearchResult,
} from "@/modules/radar";

import { MONTHLY_ANALYSIS_CAP } from "./analyses-repository";
import { createAnthropicAnalysisClient } from "./analysis-model";
import { selectIdeasToSend } from "./research-inputs";
import { ResearchRepository } from "./research-repository";
import { requestResearch } from "./research-service";
import { researchViewOf, type ResearchView } from "./research-view";

// The same per-minute floor every paid analysis has (docs/adr/0057), on top of the research's own
// (`radar/research`).
const REQUEST_RATE_LIMIT = { windowSeconds: 60, max: 3 };

export type ResearchNotice =
  | { kind: "no_key" }
  | { kind: "key_unreadable" }
  | { kind: "cap_reached"; cap: number }
  | { kind: "rate_limited" }
  | { kind: "failed" };

// What the engine found, as the browser may see it: the cards, never the pricing artifact.
export interface EngineResearchView {
  newestClose: ResearchResult["newestClose"];
  sessionsLooked: number;
  candidates: number;
  dropped: ResearchResult["dropped"];
  usingDefaultProfile: boolean;
  timedOut: boolean;
  holding: IdeaCard[];
  noLongerHolding: IdeaCard[];
}

export type ObtainSuggestionsResult =
  | {
      status: "ok";
      engine: EngineResearchView;
      // Present only when Fetha answered; the cards of `engine` are then the same ideas, in the
      // verdict groups.
      research: ResearchView | null;
      notice: ResearchNotice | null;
    }
  | { status: "error"; error: "rate_limited" | "unavailable" };

function engineViewOf(result: ResearchResult): EngineResearchView {
  return {
    newestClose: result.newestClose,
    sessionsLooked: result.sessionsLooked,
    candidates: result.candidates,
    dropped: result.dropped,
    usingDefaultProfile: result.usingDefaultProfile,
    timedOut: result.timedOut,
    holding: result.holding.map(ideaCardOf),
    noLongerHolding: result.noLongerHolding.map(ideaCardOf),
  };
}

type OpinionOutcome =
  { research: ResearchView; notice: null } | { research: null; notice: ResearchNotice | null };

async function opinionOn(result: ResearchResult): Promise<OpinionOutcome> {
  const { sent, unsent } = selectIdeasToSend(result);
  if (sent.length === 0 || result.newestClose === null) return { research: null, notice: null };
  const newestClose = result.newestClose;

  const user = await withAuthenticatedAction(() => requireUser());
  try {
    await enforceAccountRateLimit(getDb(), user.email, "analyses/request", REQUEST_RATE_LIMIT);
  } catch (error) {
    if (error instanceof AccountRateLimitExceededError) {
      return { research: null, notice: { kind: "rate_limited" } };
    }
    throw error;
  }

  const resolution = await withAuthenticatedAction(() =>
    resolveAnalysisModelForCurrentUser("research"),
  );
  if (resolution.status === "own_key_missing") {
    return { research: null, notice: { kind: "no_key" } };
  }
  if (resolution.status === "own_key_unreadable") {
    return { research: null, notice: { kind: "key_unreadable" } };
  }

  const answered = await withAuthenticatedAction(() =>
    requestResearch(
      {
        db: getDb(),
        user,
        client: createAnthropicAnalysisClient(resolution.apiKey),
        model: resolution.model,
        family: resolution.family,
        onRejected: resolution.markRejected,
      },
      {
        newestClose,
        sessionsLooked: result.sessionsLooked,
        candidates: result.candidates,
        dropped: result.dropped,
        usingDefaultProfile: result.usingDefaultProfile,
        ideas: sent,
      },
    ),
  );
  if (answered.status === "cap_reached") {
    return { research: null, notice: { kind: "cap_reached", cap: MONTHLY_ANALYSIS_CAP } };
  }
  if (answered.status !== "accepted") {
    return { research: null, notice: { kind: "failed" } };
  }

  const stored = await (
    await forCurrentUser(getDb(), ResearchRepository)
  ).find(answered.researchId);
  if (!stored) return { research: null, notice: { kind: "failed" } };
  const newest = await newestReadSession(getDb());
  return {
    research: researchViewOf({
      research: stored,
      decisions: new Map(),
      newestReadSession: newest === null ? null : sessionDateSchema.parse(newest),
      unsent: unsent.map(ideaCardOf),
    }),
    notice: null,
  };
}

// "Obter sugestões" (docs/adr/0075, docs/adr/0076): the engine's research, then one model call
// over its ideas when there are some, the user's own key is readable and the monthly cap allows
// it. Every way the opinion can be missing leaves the engine's result on screen with one notice.
export async function obtainSuggestionsAction(): Promise<ObtainSuggestionsResult> {
  const researched = await researchSuggestionsAction();
  if (researched.status === "error") return researched;

  const opinion = await opinionOn(researched.result);
  if (opinion.research) {
    revalidatePath("/");
    revalidatePath("/diario");
  }
  return {
    status: "ok",
    engine: engineViewOf(researched.result),
    research: opinion.research,
    notice: opinion.notice,
  };
}
