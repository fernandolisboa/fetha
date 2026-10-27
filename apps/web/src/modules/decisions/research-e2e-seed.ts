import type { AnalysisVerdictDecision, ResearchAlert } from "@fetha/contracts";

import type { Database } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { isProductionDeployment, readE2ESecret } from "@/modules/auth";

import { AnalysesRepository } from "./analyses-repository";
import { ResearchRepository, type NewResearch, type NewResearchIdea } from "./research-repository";

export interface SeedE2EResearchIdea extends Omit<
  NewResearchIdea,
  "position" | "verdict" | "justification" | "aiAlerts" | "inputsCited"
> {
  verdict: AnalysisVerdictDecision;
  justification: string;
  aiAlerts: ResearchAlert[];
}

export interface SeedE2EResearchInput {
  research: Omit<NewResearch, "id" | "analysisRequestId">;
  model: string;
  overview: string;
  ideas: SeedE2EResearchIdea[];
}

export type SeedE2EResearchResult =
  { ok: true; researchId: string } | { ok: false; reason: "e2e_not_available" };

// Backs the E2E-only `/api/e2e/seed-research` route, and only that route: a stored research the
// way an accepted answer leaves it (the request, its accepted result, the research and its
// ideas, one transaction), without calling a model. Each idea cites its own maximum loss, a
// fact the seeded request really holds.
export async function seedE2EResearch(
  db: Database,
  user: ScopedUser,
  input: SeedE2EResearchInput,
): Promise<SeedE2EResearchResult> {
  if (isProductionDeployment() || !readE2ESecret()) {
    return { ok: false, reason: "e2e_not_available" };
  }
  return { ok: true, researchId: await storeSeededResearch(db, user, input) };
}

// Unguarded, for the module's own integration tests as well.
export async function storeSeededResearch(
  db: Database,
  user: ScopedUser,
  input: SeedE2EResearchInput,
): Promise<string> {
  const researchId = crypto.randomUUID();
  const facts = {
    newestClose: input.research.newestClose,
    ideas: input.ideas.map((idea) => ({
      underlying: idea.underlying,
      pricing: {
        maxLoss: `R$ ${(Number(idea.pricing.maxLoss) / 100).toFixed(2).replace(".", ",")}`,
      },
    })),
  };
  const request = await new AnalysesRepository(db, user).reserve({
    subjectKind: "research",
    subjectId: researchId,
    inputs: { subject: "research", facts },
    promptVersion: "research@1",
    model: input.model,
  });
  const ideas = input.ideas.map((idea, position): NewResearchIdea => ({
    ...idea,
    position,
    inputsCited: [`ideas.${String(position)}.pricing.maxLoss`],
  }));
  await new ResearchRepository(db, user).storeAccepted({
    completion: {
      outcome: "accepted",
      output: {
        overview: input.overview,
        ideas: ideas.map((idea) => ({
          idea: `ideas.${String(idea.position)}`,
          verdict: idea.verdict,
          justification: idea.justification,
          alerts: idea.aiAlerts,
          inputsCited: idea.inputsCited,
        })),
      },
      reason: null,
      model: input.model,
      inputTokens: 0,
      outputTokens: 0,
      claim: null,
    },
    research: { ...input.research, id: researchId, analysisRequestId: request.id },
    ideas,
  });
  return researchId;
}
