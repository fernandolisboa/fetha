import {
  analysisInputsSchema,
  centavosSchema,
  MAX_RESEARCH_IDEAS_SENT,
  sessionDateSchema,
  type AnalysisInputs,
  type SessionDate,
} from "@fetha/contracts";

import type { Database } from "@/db/client";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";
import { tradingSessionOnOrAfter } from "@/modules/market-data";
import {
  getSuggestionCalibration,
  type Idea,
  type ResearchResult,
  type SuggestionCalibration,
} from "@/modules/radar";
import {
  AVERAGE_WINDOW_DAYS,
  sentimentForInstrument,
  type SentimentView,
} from "@/modules/sentiment";
import { recipeById } from "@/modules/strategies";

import { researchFacts, type ResearchIdeaFactsInput } from "./analysis-facts";

export interface SentIdeas {
  sent: Idea[];
  // Past the cut, shown with the engine's numbers only (docs/adr/0076).
  unsent: Idea[];
}

// Holding first, then no longer holding, each in the order the engine gave them: the model never
// orders ideas, and the first twenty are the ones it opines on.
export function selectIdeasToSend(
  result: Pick<ResearchResult, "holding" | "noLongerHolding">,
): SentIdeas {
  const all = [...result.holding, ...result.noLongerHolding];
  return {
    sent: all.slice(0, MAX_RESEARCH_IDEAS_SENT),
    unsent: all.slice(MAX_RESEARCH_IDEAS_SENT),
  };
}

type IdeaContext = Pick<
  ResearchIdeaFactsInput,
  "trackRecord" | "filings" | "newsTone" | "providerNews"
>;

const NO_CONTEXT: IdeaContext = {
  trackRecord: null,
  filings: [],
  newsTone: null,
  providerNews: [],
};

export function ideaContextOf(
  idea: Pick<Idea, "recipeId">,
  calibration: SuggestionCalibration,
  sentiment: SentimentView | null,
): IdeaContext {
  const line = calibration.byRecipe.find((entry) => entry.recipeId === idea.recipeId);
  const trackRecord =
    line && line.scored > 0
      ? {
          claimed: line.claimed,
          held: line.held,
          scored: line.scored,
          averagePnl: centavosSchema.parse(Math.round(line.pnl / line.scored)),
        }
      : null;
  if (!sentiment) return { ...NO_CONTEXT, trackRecord };
  const providerNews = sentiment.provider.articles.map((article) => ({
    publishedOn: todaySaoPauloDate(article.publishedAt),
    title: article.title,
    sentiment: article.sentiment,
  }));
  if (!sentiment.mapped) return { ...NO_CONTEXT, trackRecord, providerNews };
  return {
    trackRecord,
    providerNews,
    filings: sentiment.filings.latest.map((filing) => ({
      deliveredOn: sessionDateSchema.parse(filing.deliveredOn),
      topic: filing.topic,
      tone: filing.tone,
      summary: filing.summary,
    })),
    newsTone: sentiment.newsTone.average
      ? {
          tone: sentiment.newsTone.average.tone,
          articles: sentiment.newsTone.average.articles,
          windowDays: AVERAGE_WINDOW_DAYS,
        }
      : null,
  };
}

// Codes only (docs/adr/0076): a breached limit is named, never its value, which derives from the
// user's declared capital.
function engineAlertCodes(idea: Idea): string[] {
  return idea.alerts.map((alert) =>
    alert.kind === "limit_breach" ? `limit_breach:${alert.breach.limit}` : alert.kind,
  );
}

export function buildResearchInputs(input: {
  newestClose: SessionDate;
  ideas: readonly Idea[];
  context: (idea: Idea) => IdeaContext;
}): { ok: true; inputs: AnalysisInputs } | { ok: false } {
  const facts = researchFacts({
    newestClose: input.newestClose,
    ideas: input.ideas.map((idea) => {
      const recipe = recipeById(idea.recipeId);
      return {
        underlying: idea.underlying,
        structure: idea.structure.name,
        foundOn: idea.foundOn,
        ruleHolds: !idea.alerts.some((alert) => alert.kind === "rule_no_longer_holds"),
        expiry: idea.expiry,
        sessionsToExpiry: idea.sessionsToExpiry,
        recipe: {
          expectedMove: recipe?.expectedMove ?? "",
          ivRegime: recipe?.ivRegime ?? "",
          entry: recipe?.definition.entry ?? null,
          exit: recipe?.definition.exit ?? null,
        },
        reading: idea.reading,
        engineAlerts: engineAlertCodes(idea),
        pricing: idea.pricing,
        ...input.context(idea),
      };
    }),
  });
  const parsed = analysisInputsSchema.safeParse({ subject: "research", facts });
  // A tree the schema rejects (too deep, a key it refuses) is not analyzable, the same as a
  // single object's (docs/adr/0057).
  return parsed.success ? { ok: true, inputs: parsed.data } : { ok: false };
}

// Shared reference data only: the recipes' calibration and each underlying's filings and news,
// as they stood at the newest close (docs/adr/0076): the lot is entered, and later scored, at that
// close, so nothing delivered after it may inform the verdict. An underlying without any context
// sends nothing.
export async function assembleResearchInputs(
  db: Database,
  input: { newestClose: SessionDate; ideas: readonly Idea[]; now: Date },
): Promise<{ ok: true; inputs: AnalysisInputs } | { ok: false }> {
  const close = await tradingSessionOnOrAfter(db, input.newestClose);
  const knownAt = close ? new Date(close.close) : new Date(`${input.newestClose}T00:00:00.000Z`);
  const tickers = [...new Set(input.ideas.map((idea) => idea.underlying))];
  const [calibration, sentiments] = await Promise.all([
    getSuggestionCalibration(),
    Promise.all(
      tickers.map(
        async (ticker) =>
          [ticker, await sentimentForInstrument(db, ticker, input.now, knownAt)] as const,
      ),
    ),
  ]);
  const sentimentOf = new Map<string, SentimentView>(sentiments);
  return buildResearchInputs({
    newestClose: input.newestClose,
    ideas: input.ideas,
    context: (idea) => ideaContextOf(idea, calibration, sentimentOf.get(idea.underlying) ?? null),
  });
}
