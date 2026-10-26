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
import { engine, type AssetReading, type MarketView } from "@fetha/engine";

import type { Database } from "@/db/client";
import { safeDbErrorMessage } from "@/db/pg-error";
import {
  buildRadarView,
  latestCandle,
  latestSessionOnOrBefore,
  tradingSessionForDate,
} from "@/modules/market-data";
import { DEFAULT_RISK_PROFILE, type RiskContext } from "@/modules/portfolio";
import { catalog, recipeById } from "@/modules/strategies";

import type { RadarLeg } from "./match";
import { recentFindings } from "./radar-repository";
import { priceRecipeLot, recipeEntryHeld, type PricedLot } from "./read-underlying";
import {
  assessIdea,
  dedupeCandidates,
  emptyDropped,
  RESEARCH_WINDOW_SESSIONS,
  sessionsAfter,
  sortIdeas,
  type Candidate,
  type DropReason,
  type IdeaAlert,
} from "./research-rules";

export interface IdeaLeg extends RadarLeg {
  quantity: number;
  price: DecimalString;
}

export interface Idea {
  underlying: Ticker;
  recipeId: string;
  structure: { id: string; name: string };
  foundOn: SessionDate;
  expiry: SessionDate;
  sessionsToExpiry: number;
  legs: IdeaLeg[];
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
  clock?: () => number;
}

function ideaLegs(lot: PricedLot): IdeaLeg[] | null {
  const legs: IdeaLeg[] = [];
  for (const [index, valuation] of lot.pricing.legs.entries()) {
    const radarLeg = lot.legs[index];
    if (!radarLeg || valuation.price === null) return null;
    legs.push({ ...radarLeg, quantity: valuation.leg.quantity, price: valuation.price });
  }
  return legs;
}

interface Researcher {
  candidate: Candidate;
  view: MarketView;
  reading: AssetReading;
  ticker: Ticker;
  close: SessionDate;
  at: Instant;
}

type Outcome =
  { kind: "drop"; reason: DropReason } | { kind: "idea"; holding: boolean; idea: Idea };

async function researchCandidate(input: ResearchInput, context: Researcher): Promise<Outcome> {
  const { candidate, view, reading, ticker, close, at } = context;
  const recipe = recipeById(candidate.recipeId);
  const structure = catalog.find(
    (entry) => entry.structure.id === recipe?.definition.structureId,
  )?.structure;
  if (!recipe || !structure) return { kind: "drop", reason: "unpriced" };

  const profile = input.riskProfile ?? DEFAULT_RISK_PROFILE;
  const entry = { recipe, view, ticker, at };
  const ruleHolds = await recipeEntryHeld(entry);
  if (ruleHolds === null) return { kind: "drop", reason: "unpriced" };
  const lot = await priceRecipeLot({
    ...entry,
    riskProfile: profile,
    openOperationCount: input.openOperationCount,
  });
  const draft = lot?.suggestion ?? null;
  const legs = lot && draft ? ideaLegs(lot) : null;
  const pricing = draft?.pricing;
  const maxLoss = pricing?.maxLoss;

  const sessionsToExpiry = draft
    ? sessionsAfter(
        view.calendar.map((session) => session.date),
        close,
        draft.horizon,
      )
    : null;
  const assessment = assessIdea({
    ruleHolds,
    foundOn: candidate.session,
    lot: legs && typeof maxLoss === "number" ? { maxLoss } : null,
    sessionsToExpiry,
    declaredCapital: profile.declaredCapital,
    breaches: pricing?.limitBreaches ?? [],
  });
  if (assessment.kind === "drop") return assessment;
  if (!draft || !pricing || !legs || typeof maxLoss !== "number" || sessionsToExpiry === null) {
    return { kind: "drop", reason: "unpriced" };
  }

  return {
    kind: "idea",
    holding: assessment.holding,
    idea: {
      underlying: ticker,
      recipeId: recipe.id,
      structure: { id: structure.id, name: structure.name },
      foundOn: candidate.session,
      expiry: draft.horizon,
      sessionsToExpiry,
      legs,
      netPremium: pricing.netPremium,
      maxLoss,
      maxGain: pricing.maxGain,
      breakEvens: pricing.breakEvens,
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

// docs/adr/0075: the radar's findings of its last few read sessions, re-checked at the newest
// close against `riskProfile` (or the default one), on demand and never stored. One market view
// per underlying; the work stops at `deadlineAt` and says so.
export async function researchSuggestions(
  db: Database,
  input: ResearchInput,
): Promise<ResearchResult> {
  const clock = input.clock ?? Date.now;
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
    candidates: candidates.length,
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
    if (clock() >= input.deadlineAt) {
      timedOut = true;
      break;
    }
    const ticker = tickerSchema.safeParse(underlying);
    if (!ticker.success || lastSessions.get(underlying) !== newest) {
      dropped.unpriced += group.length;
      continue;
    }
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
      }
    } catch (error) {
      console.error("suggestion research failed for an underlying", safeDbErrorMessage(error));
      dropped.unpriced += group.length;
    }
  }
  return result(trading.date);
}
