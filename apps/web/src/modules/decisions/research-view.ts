import {
  factAt,
  type AnalysisFacts,
  type AnalysisVerdictDecision,
  type ResearchAlert,
  type SessionDate,
  tickerSchema,
} from "@fetha/contracts";
import type { DecisionKind } from "@fetha/engine";

import { recipeStructureById, type DropReason, type IdeaCard } from "@/modules/radar";

import type { DecisionListItem } from "./decisions-repository";
import type { StoredResearch, StoredResearchIdea } from "./research-repository";
import { t } from "./strings";

export interface CitedFact {
  label: string;
  value: string | null;
}

export interface ResearchIdeaView {
  id: string;
  card: IdeaCard;
  verdict: AnalysisVerdictDecision;
  justification: string;
  aiAlerts: ResearchAlert[];
  cited: CitedFact[];
  decision: { kind: DecisionKind; decidedAt: Date } | null;
  defaultHorizon: SessionDate;
}

// What the home page draws of a stored research (docs/adr/0076): the AI's words next to the
// engine's numbers, each verdict group in the order the engine gave the ideas.
export interface ResearchView {
  id: string;
  createdAt: Date;
  model: string;
  newestClose: SessionDate;
  overview: string;
  sessionsLooked: number;
  candidates: number;
  dropped: Record<DropReason, number>;
  usingDefaultProfile: boolean;
  supersededBy: SessionDate | null;
  groups: Record<AnalysisVerdictDecision, ResearchIdeaView[]>;
  unsent: IdeaCard[];
}

const INDEX = /^(0|[1-9]\d*)$/;

export function citedFactLabel(path: string): string {
  const segments = path.split(".");
  const rest =
    segments[0] === "ideas" && INDEX.test(segments[1] ?? "") ? segments.slice(2) : segments;
  const labels: Record<string, string> = t.research.factLabels;
  return rest
    .map((segment) =>
      INDEX.test(segment) ? `#${String(Number(segment) + 1)}` : (labels[segment] ?? segment),
    )
    .join(" · ");
}

function citedFacts(facts: AnalysisFacts, paths: readonly string[]): CitedFact[] {
  return paths.map((path) => {
    const value = factAt(facts, path);
    return { label: citedFactLabel(path), value: typeof value === "string" ? value : null };
  });
}

export function ideaCardOfStored(idea: StoredResearchIdea): IdeaCard {
  return {
    underlying: tickerSchema.parse(idea.underlying),
    recipeId: idea.recipeId,
    structure: recipeStructureById(idea.recipeId) ?? { id: idea.recipeId, name: idea.recipeId },
    foundOn: idea.foundOn,
    expiry: idea.horizon,
    sessionsToExpiry: idea.sessionsToExpiry,
    legs: idea.legs,
    netPremium: idea.pricing.netPremium,
    maxLoss: idea.pricing.maxLoss,
    maxGain: idea.pricing.maxGain,
    breakEvens: idea.pricing.breakEvens,
    reading: idea.reading,
    alerts: idea.engineAlerts,
    suggestionId: idea.suggestionId,
    chart: { payoff: idea.pricing.payoff, spot: idea.pricing.spot },
  };
}

export function researchViewOf(input: {
  research: StoredResearch;
  decisions: ReadonlyMap<string, Pick<DecisionListItem, "kind" | "decidedAt">>;
  newestReadSession: SessionDate | null;
  unsent?: IdeaCard[];
}): ResearchView {
  const { research } = input;
  const groups: ResearchView["groups"] = { enter: [], wait: [], do_not_enter: [] };
  for (const idea of [...research.ideas].sort((a, b) => a.position - b.position)) {
    const decision = input.decisions.get(idea.id);
    groups[idea.verdict].push({
      id: idea.id,
      card: ideaCardOfStored(idea),
      verdict: idea.verdict,
      justification: idea.justification,
      aiAlerts: idea.aiAlerts,
      cited: citedFacts(research.inputs.facts, idea.inputsCited),
      decision: decision ? { kind: decision.kind, decidedAt: decision.decidedAt } : null,
      defaultHorizon: idea.horizon,
    });
  }
  const supersededBy =
    input.newestReadSession !== null && input.newestReadSession > research.newestClose
      ? input.newestReadSession
      : null;
  return {
    id: research.id,
    createdAt: research.createdAt,
    model: research.model,
    newestClose: research.newestClose,
    overview: research.overview,
    sessionsLooked: research.sessionsLooked,
    candidates: research.candidates,
    dropped: research.dropped,
    usingDefaultProfile: research.usingDefaultProfile,
    supersededBy,
    groups,
    unsent: input.unsent ?? [],
  };
}
