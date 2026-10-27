import { and, asc, desc, eq } from "drizzle-orm";
import {
  analysisInputsSchema,
  analysisVerdicts,
  sessionDateSchema,
  thesisClaimSchema,
  researchOutputSchema,
  type AnalysisInputs,
  type AnalysisVerdictDecision,
  type ResearchAlert,
  type SessionDate,
  type ThesisClaim,
} from "@fetha/contracts";
import type { AssetReading, OperationPricing } from "@fetha/engine";
import { z } from "zod";

import { UserScopedRepository } from "@/lib/user-scoped-repository";
import {
  ideaAlertSchema,
  lotLegsSchema,
  type DropReason,
  type IdeaAlert,
  type LotLeg,
} from "@/modules/radar";

import { AnalysesRepository, type CompleteAnalysisInput } from "./analyses-repository";
import {
  storedAiAlertsSchema,
  storedDroppedSchema,
  storedIdeaPricingSchema,
  storedInputsCitedSchema,
  type StoredIdeaPricing,
} from "./research-schemas";
import { analysisRequests, analysisResults, researchIdeas, suggestionResearches } from "./schema";

export interface NewResearch {
  id: string;
  analysisRequestId: string;
  newestClose: SessionDate;
  sessionsLooked: number;
  candidates: number;
  dropped: Record<DropReason, number>;
  usingDefaultProfile: boolean;
}

export interface NewResearchIdea {
  position: number;
  underlying: string;
  recipeId: string;
  foundOn: SessionDate;
  suggestionId: string | null;
  sessionsToExpiry: number;
  legs: LotLeg[];
  pricing: OperationPricing;
  reading: AssetReading;
  engineAlerts: IdeaAlert[];
  verdict: AnalysisVerdictDecision;
  justification: string;
  aiAlerts: ResearchAlert[];
  inputsCited: string[];
  claim: ThesisClaim;
  horizon: SessionDate;
}

export interface StoredResearchIdea {
  id: string;
  researchId: string;
  position: number;
  underlying: string;
  recipeId: string;
  foundOn: SessionDate;
  suggestionId: string | null;
  newestClose: SessionDate;
  sessionsToExpiry: number;
  legs: LotLeg[];
  pricing: StoredIdeaPricing;
  reading: AssetReading;
  engineAlerts: IdeaAlert[];
  verdict: AnalysisVerdictDecision;
  justification: string;
  aiAlerts: ResearchAlert[];
  inputsCited: string[];
  claim: ThesisClaim;
  horizon: SessionDate;
}

export interface StoredResearch {
  id: string;
  createdAt: Date;
  newestClose: SessionDate;
  sessionsLooked: number;
  candidates: number;
  dropped: Record<DropReason, number>;
  usingDefaultProfile: boolean;
  model: string;
  overview: string;
  inputs: AnalysisInputs;
  ideas: StoredResearchIdea[];
}

const verdictSchema = z.enum(analysisVerdicts);
const engineAlertsSchema = z.array(ideaAlertSchema);

// jsonb is validated on read like the radar's own rows: an idea an older shape wrote is dropped
// rather than drawn or scored wrong.
function toStoredIdea(row: typeof researchIdeas.$inferSelect): StoredResearchIdea | null {
  const legs = lotLegsSchema.safeParse(row.legs);
  const pricing = storedIdeaPricingSchema.safeParse(row.pricing);
  const engineAlerts = engineAlertsSchema.safeParse(row.engineAlerts);
  const verdict = verdictSchema.safeParse(row.verdict);
  const aiAlerts = storedAiAlertsSchema.safeParse(row.aiAlerts);
  const inputsCited = storedInputsCitedSchema.safeParse(row.inputsCited);
  const claim = thesisClaimSchema.safeParse(row.claim);
  const foundOn = sessionDateSchema.safeParse(row.foundOn);
  const newestClose = sessionDateSchema.safeParse(row.newestClose);
  const horizon = sessionDateSchema.safeParse(row.horizon);
  if (
    !legs.success ||
    !pricing.success ||
    !engineAlerts.success ||
    !verdict.success ||
    !aiAlerts.success ||
    !inputsCited.success ||
    !claim.success ||
    !foundOn.success ||
    !newestClose.success ||
    !horizon.success
  ) {
    return null;
  }
  return {
    id: row.id,
    researchId: row.researchId,
    position: row.position,
    underlying: row.underlying,
    recipeId: row.recipeId,
    foundOn: foundOn.data,
    suggestionId: row.suggestionId,
    newestClose: newestClose.data,
    sessionsToExpiry: row.sessionsToExpiry,
    legs: legs.data,
    pricing: pricing.data,
    reading: row.reading,
    engineAlerts: engineAlerts.data,
    verdict: verdict.data,
    justification: row.justification,
    aiAlerts: aiAlerts.data,
    inputsCited: inputsCited.data,
    claim: claim.data,
    horizon: horizon.data,
  };
}

// The user's own researches and ideas (docs/adr/0076): append-only, written together with the
// analysis result that accepted them, read only through the session user.
export class ResearchRepository extends UserScopedRepository {
  // The result row, the research and its ideas land in one transaction: a failure leaves none of
  // them, so the request keeps no result and the caller can settle it as rejected.
  async storeAccepted(input: {
    completion: CompleteAnalysisInput;
    research: NewResearch;
    ideas: readonly NewResearchIdea[];
  }): Promise<void> {
    const { completion, research, ideas } = input;
    await this.db.transaction(async (tx) => {
      await new AnalysesRepository(this.db, this.currentUser).complete(
        research.analysisRequestId,
        completion,
        tx,
      );
      await tx.insert(suggestionResearches).values({
        id: research.id,
        userId: this.userId,
        analysisRequestId: research.analysisRequestId,
        newestClose: research.newestClose,
        sessionsLooked: research.sessionsLooked,
        candidates: research.candidates,
        dropped: storedDroppedSchema.parse(research.dropped),
        usingDefaultProfile: research.usingDefaultProfile,
      });
      await tx.insert(researchIdeas).values(
        ideas.map((idea) => ({
          researchId: research.id,
          userId: this.userId,
          position: idea.position,
          underlying: idea.underlying,
          recipeId: idea.recipeId,
          foundOn: idea.foundOn,
          suggestionId: idea.suggestionId,
          newestClose: research.newestClose,
          sessionsToExpiry: idea.sessionsToExpiry,
          legs: lotLegsSchema.parse(idea.legs),
          pricing: idea.pricing,
          reading: idea.reading,
          engineAlerts: engineAlertsSchema.parse(idea.engineAlerts),
          verdict: idea.verdict,
          justification: idea.justification,
          aiAlerts: storedAiAlertsSchema.parse(idea.aiAlerts),
          inputsCited: idea.inputsCited,
          claim: thesisClaimSchema.parse(idea.claim),
          horizon: idea.horizon,
        })),
      );
    });
  }

  async latest(): Promise<StoredResearch | null> {
    return this.read(desc(suggestionResearches.createdAt), undefined);
  }

  async find(researchId: string): Promise<StoredResearch | null> {
    return this.read(desc(suggestionResearches.createdAt), researchId);
  }

  private async read(
    order: ReturnType<typeof desc>,
    researchId: string | undefined,
  ): Promise<StoredResearch | null> {
    const [row] = await this.db
      .select({
        research: suggestionResearches,
        output: analysisResults.output,
        model: analysisResults.model,
        inputs: analysisRequests.inputs,
      })
      .from(suggestionResearches)
      .innerJoin(
        analysisResults,
        and(
          eq(analysisResults.requestId, suggestionResearches.analysisRequestId),
          eq(analysisResults.userId, this.userId),
        ),
      )
      .innerJoin(
        analysisRequests,
        and(
          eq(analysisRequests.id, suggestionResearches.analysisRequestId),
          eq(analysisRequests.userId, this.userId),
        ),
      )
      .where(
        and(
          eq(suggestionResearches.userId, this.userId),
          researchId === undefined ? undefined : eq(suggestionResearches.id, researchId),
        ),
      )
      .orderBy(order)
      .limit(1);
    if (!row) return null;

    const output = researchOutputSchema.safeParse(row.output);
    const inputs = analysisInputsSchema.safeParse(row.inputs);
    const dropped = storedDroppedSchema.safeParse(row.research.dropped);
    const newestClose = sessionDateSchema.safeParse(row.research.newestClose);
    if (!output.success || !inputs.success || !dropped.success || !newestClose.success) {
      return null;
    }
    const ideaRows = await this.db
      .select()
      .from(researchIdeas)
      .where(
        and(eq(researchIdeas.userId, this.userId), eq(researchIdeas.researchId, row.research.id)),
      )
      .orderBy(asc(researchIdeas.position));
    return {
      id: row.research.id,
      createdAt: row.research.createdAt,
      newestClose: newestClose.data,
      sessionsLooked: row.research.sessionsLooked,
      candidates: row.research.candidates,
      dropped: dropped.data,
      usingDefaultProfile: row.research.usingDefaultProfile,
      model: row.model ?? "",
      overview: output.data.overview,
      inputs: inputs.data,
      ideas: ideaRows.flatMap((idea) => toStoredIdea(idea) ?? []),
    };
  }

  async findIdea(ideaId: string): Promise<StoredResearchIdea | null> {
    const [row] = await this.db
      .select()
      .from(researchIdeas)
      .where(and(eq(researchIdeas.userId, this.userId), eq(researchIdeas.id, ideaId)))
      .limit(1);
    return row ? toStoredIdea(row) : null;
  }

  async ideaIdsOf(researchId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: researchIdeas.id })
      .from(researchIdeas)
      .where(and(eq(researchIdeas.userId, this.userId), eq(researchIdeas.researchId, researchId)));
    return rows.map((row) => row.id);
  }
}
