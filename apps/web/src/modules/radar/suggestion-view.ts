import type {
  Centavos,
  ContemplatedLeg,
  DecimalString,
  Recipe,
  SessionDate,
  ThesisClaim,
} from "@fetha/contracts";
import type { AssetReading, OperationPricing } from "@fetha/engine";

import { catalog, recipeById } from "@/modules/strategies";

import type { RadarFacts, RadarLeg } from "./match";
import type { SuggestionValidity } from "./suggestion-validity";
import type { SuggestionInContext } from "./suggestions-repository";

export interface SuggestionView {
  id: string;
  underlying: string;
  session: SessionDate;
  horizon: SessionDate;
  recipe: Recipe;
  recipeId: string;
  structure: { id: string; name: string };
  reading: AssetReading | null;
  facts: RadarFacts;
  legs: (RadarLeg & { quantity: number; price: DecimalString })[];
  entryLegs: (ContemplatedLeg & { entryPrice: DecimalString })[];
  pricing: OperationPricing;
  maxLoss: Centavos;
  claim: ThesisClaim;
  validity: SuggestionValidity;
}

// What the cards, the suggestion page and the decision snapshot read: the stored suggestion with
// its recipe and structure resolved from the book. A suggestion whose recipe left the book, or
// whose stored legs no longer line up with its pricing, is dropped like the radar drops its match.
export function suggestionView(
  stored: SuggestionInContext,
  validity: SuggestionValidity,
): SuggestionView | null {
  const recipe = recipeById(stored.recipeId);
  const structure = catalog.find(
    (entry) => entry.structure.id === recipe?.definition.structureId,
  )?.structure;
  if (!recipe || !structure || stored.pricing.maxLoss === "unbounded") return null;

  const legs: SuggestionView["legs"] = [];
  const entryLegs: SuggestionView["entryLegs"] = [];
  for (const [index, leg] of stored.legs.entries()) {
    const price = stored.pricing.legs[index]?.price ?? null;
    const radarLeg = stored.radarLegs[index];
    if (price === null || !radarLeg || radarLeg.ticker !== leg.ticker) return null;
    legs.push({ ...radarLeg, quantity: leg.quantity, price });
    entryLegs.push({
      role: leg.role,
      side: leg.side,
      ticker: leg.ticker,
      quantity: leg.quantity,
      entryPrice: price,
    });
  }

  return {
    id: stored.id,
    underlying: stored.underlying,
    session: stored.session,
    horizon: stored.horizon,
    recipe,
    recipeId: stored.recipeId,
    structure: { id: structure.id, name: structure.name },
    reading: stored.reading,
    facts: stored.facts,
    legs,
    entryLegs,
    pricing: stored.pricing,
    maxLoss: stored.pricing.maxLoss,
    claim: stored.claim,
    validity,
  };
}
