"use server";

import { unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sessionDateSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { safeDbErrorMessage } from "@/db/pg-error";
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

import { createAnthropicAnalysisClient } from "./analysis-model";
import { opinionOn, type ResearchNotice } from "./research-opinion";
import { ResearchRepository } from "./research-repository";
import { requestResearch } from "./research-service";
import type { ResearchView } from "./research-view";

// The same per-minute floor every paid analysis has (docs/adr/0057), on top of the research's own
// (`radar/research`).
const REQUEST_RATE_LIMIT = { windowSeconds: 60, max: 3 };

export type { ResearchNotice };

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

// "Obter sugestões" (docs/adr/0075, docs/adr/0076): the engine's research, then one model call
// over its ideas when there are some, the user's own key is readable and the monthly cap allows
// it. Every way the opinion can be missing leaves the engine's result on screen with one notice.
export async function obtainSuggestionsAction(): Promise<ObtainSuggestionsResult> {
  const startedAt = Date.now();
  const researched = await researchSuggestionsAction();
  if (researched.status === "error") return researched;

  let signedIn: ReturnType<typeof requireUser> | undefined;
  const currentUser = () => (signedIn ??= withAuthenticatedAction(() => requireUser()));
  const opinion = await opinionOn(researched.result, startedAt, {
    resolveModel: () =>
      withAuthenticatedAction(() => resolveAnalysisModelForCurrentUser("research")),
    takeRequestToken: async () => {
      try {
        const user = await currentUser();
        await enforceAccountRateLimit(getDb(), user.email, "analyses/request", REQUEST_RATE_LIMIT);
        return true;
      } catch (error) {
        if (error instanceof AccountRateLimitExceededError) return false;
        throw error;
      }
    },
    request: async (choice, input, mustStartBy) => {
      const user = await currentUser();
      return withAuthenticatedAction(() =>
        requestResearch(
          {
            db: getDb(),
            user,
            client: createAnthropicAnalysisClient(choice.apiKey),
            model: choice.model,
            family: choice.family,
            onRejected: choice.markRejected,
            mustStartBy,
          },
          input,
        ),
      );
    },
    readStored: async (researchId) =>
      (await forCurrentUser(getDb(), ResearchRepository)).find(researchId),
    newestReadSession: async () => {
      const newest = await newestReadSession(getDb());
      return newest === null ? null : sessionDateSchema.parse(newest);
    },
    toCard: ideaCardOf,
    clock: Date.now,
    onError: (error) => {
      unstable_rethrow(error);
      console.error("obtainSuggestionsAction opinion failed", safeDbErrorMessage(error));
    },
  });
  if (opinion.stored) {
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
