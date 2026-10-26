import {
  instantSchema,
  sessionDateSchema,
  tickerSchema,
  type Centavos,
  type DecimalString,
  type Instant,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";
import { engine, type AssetReading, type MarketView, type OperationPricing } from "@fetha/engine";

import type { Database } from "@/db/client";
import { safeDbErrorMessage } from "@/db/pg-error";
import {
  buildRadarView,
  latestCandle,
  latestSessionOnOrBefore,
  tradingSessionForDate,
} from "@/modules/market-data";
import { DEFAULT_RISK_PROFILE, type RiskContext } from "@/modules/portfolio";
import { recipeById } from "@/modules/strategies";

import { lotLegsOf, type LotLeg } from "./lot-legs";
import { recentFindings } from "./radar-repository";
import { recipeStructure } from "./recipe-structure";
import { priceRecipeLot, recipeEntryState, type PricedLot } from "./read-underlying";
import {
  assessIdea,
  dedupeCandidates,
  dropReasons,
  emptyDropped,
  RESEARCH_WINDOW_SESSIONS,
  sessionsAfter,
  sortIdeas,
  type Candidate,
  type DropReason,
  type IdeaAlert,
} from "./research-rules";

export interface Idea {
  underlying: Ticker;
  recipeId: string;
  structure: { id: string; name: string };
  foundOn: SessionDate;
  expiry: SessionDate;
  sessionsToExpiry: number;
  legs: LotLeg[];
  netPremium: Centavos;
  maxLoss: Centavos;
  maxGain: Centavos | "unbounded";
  breakEvens: DecimalString[];
  reading: AssetReading;
  alerts: IdeaAlert[];
  suggestionId: string | null;
}

export interface ResearchResult {
  newestClose: SessionDate | null;
  sessionsLooked: number;
  candidates: number;
  holding: Idea[];
  noLongerHolding: Idea[];
  dropped: Record<DropReason, number>;
  usingDefaultProfile: boolean;
  timedOut: boolean;
}

export interface ResearchInput extends RiskContext {
  now: Date;
  deadlineAt: number;
}

interface UnderlyingContext {
  candidate: Candidate;
  view: MarketView;
  reading: AssetReading;
  ticker: Ticker;
  close: SessionDate;
  at: Instant;
}

interface ResearchLot {
  pricing: OperationPricing;
  maxLoss: Centavos;
  legs: LotLeg[];
  expiry: SessionDate;
}

function researchLot(lot: PricedLot | null): ResearchLot | null {
  const draft = lot?.suggestion;
  if (!lot || !draft) return null;
  const { maxLoss } = draft.pricing;
  const legs = lotLegsOf(
    draft.pricing.legs.map((valuation) => valuation.leg),
    draft.pricing.legs.map((valuation) => valuation.price),
    lot.legs,
  );
  if (maxLoss === "unbounded" || !legs) return null;
  return { pricing: draft.pricing, maxLoss, legs, expiry: draft.horizon };
}

type Outcome =
  { kind: "drop"; reason: DropReason } | { kind: "idea"; holding: boolean; idea: Idea };

async function researchCandidate(
  input: ResearchInput,
  context: UnderlyingContext,
): Promise<Outcome> {
  const { candidate, view, reading, ticker, close, at } = context;
  const recipe = recipeById(candidate.recipeId);
  const structure = recipe ? recipeStructure(recipe) : null;
  if (!recipe || !structure) return { kind: "drop", reason: "unpriced" };

  const profile = input.riskProfile ?? DEFAULT_RISK_PROFILE;
  const entry = { recipe, view, ticker, at };
  const state = await recipeEntryState(entry);
  if (state === "not_evaluable") return { kind: "drop", reason: "not_evaluable" };
  const lot = researchLot(
    await priceRecipeLot({
      ...entry,
      riskProfile: profile,
      openOperationCount: input.openOperationCount,
    }),
  );
  if (!lot) return { kind: "drop", reason: "unpriced" };

  const sessionsToExpiry = sessionsAfter(
    view.calendar.map((session) => session.date),
    close,
    lot.expiry,
  );
  const assessment = assessIdea({
    ruleHolds: state === "held",
    foundOn: candidate.session,
    maxLoss: lot.maxLoss,
    sessionsToExpiry,
    declaredCapital: profile.declaredCapital,
    breaches: lot.pricing.limitBreaches,
  });
  if (assessment.kind === "drop") return assessment;

  return {
    kind: "idea",
    holding: assessment.holding,
    idea: {
      underlying: ticker,
      recipeId: recipe.id,
      structure: { id: structure.id, name: structure.name },
      foundOn: candidate.session,
      expiry: lot.expiry,
      sessionsToExpiry,
      legs: lot.legs,
      netPremium: lot.pricing.netPremium,
      maxLoss: lot.maxLoss,
      maxGain: lot.pricing.maxGain,
      breakEvens: lot.pricing.breakEvens,
      reading,
      alerts: assessment.alerts,
      suggestionId: candidate.suggestionId,
    },
  };
}

function groupByUnderlying(candidates: readonly Candidate[]): Map<string, Candidate[]> {
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    groups.set(candidate.underlying, [...(groups.get(candidate.underlying) ?? []), candidate]);
  }
  return groups;
}

export async function researchSuggestions(
  db: Database,
  input: ResearchInput,
): Promise<ResearchResult> {
  const dropped = emptyDropped();
  const holding: Idea[] = [];
  const noLongerHolding: Idea[] = [];
  let timedOut = false;

  const { sessions, findings } = await recentFindings(db, RESEARCH_WINDOW_SESSIONS);
  const candidates = dedupeCandidates(findings.filter((row) => recipeById(row.recipeId)));
  const latest = await latestSessionOnOrBefore(db, input.now);
  const result = (newestClose: SessionDate | null): ResearchResult => ({
    newestClose,
    sessionsLooked: sessions.length,
    candidates:
      holding.length +
      noLongerHolding.length +
      dropReasons.reduce((sum, reason) => sum + dropped[reason], 0),
    holding: sortIdeas(holding),
    noLongerHolding: sortIdeas(noLongerHolding),
    dropped,
    usingDefaultProfile: input.riskProfile === null,
    timedOut,
  });
  if (!latest || candidates.length === 0) {
    return result(latest ? sessionDateSchema.parse(latest.date) : null);
  }

  const groups = groupByUnderlying(candidates);
  const lastSessions = new Map<string, string>();
  for (const underlying of groups.keys()) {
    const candle = await latestCandle(db, underlying);
    if (candle)
      lastSessions.set(underlying, candle.session < latest.date ? candle.session : latest.date);
  }
  const newest = [...lastSessions.values()].sort().at(-1) ?? latest.date;
  const trading = await tradingSessionForDate(db, newest);
  if (!trading) return result(null);
  const at = instantSchema.parse(trading.close);

  for (const [underlying, group] of groups) {
    if (Date.now() >= input.deadlineAt) {
      timedOut = true;
      break;
    }
    const ticker = tickerSchema.safeParse(underlying);
    if (!ticker.success || lastSessions.get(underlying) !== newest) {
      dropped.unpriced += group.length;
      continue;
    }
    let researched = 0;
    try {
      const view = await buildRadarView(db, ticker.data, new Date(at));
      const reading = await engine.assetReading({ view, ticker: ticker.data, at });
      if (!reading.ok) {
        dropped.unpriced += group.length;
        continue;
      }
      for (const candidate of group) {
        const outcome = await researchCandidate(input, {
          candidate,
          view,
          reading: reading.value,
          ticker: ticker.data,
          close: trading.date,
          at,
        });
        if (outcome.kind === "drop") dropped[outcome.reason] += 1;
        else (outcome.holding ? holding : noLongerHolding).push(outcome.idea);
        researched += 1;
      }
    } catch (error) {
      console.error("suggestion research failed for an underlying", safeDbErrorMessage(error));
      dropped.unpriced += group.length - researched;
    }
  }
  return result(trading.date);
}
