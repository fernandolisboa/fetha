import type {
  Centavos,
  ContemplatedLeg,
  DecimalString,
  Recipe,
  SessionDate,
  ThesisClaim,
} from "@fetha/contracts";
import type { AssetReading, OperationPricing } from "@fetha/engine";

import { recipeById } from "@/modules/strategies";

import { lotLegsOf, type LotLeg } from "./lot-legs";
import type { RadarFacts } from "./match";
import { recipeStructure } from "./recipe-structure";
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
  legs: LotLeg[];
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
  const structure = recipe ? recipeStructure(recipe) : null;
  if (!recipe || !structure || stored.pricing.maxLoss === "unbounded") return null;

  const legs = lotLegsOf(
    stored.legs,
    stored.pricing.legs.map((valuation) => valuation.price),
    stored.radarLegs,
  );
  if (!legs) return null;
  const entryLegs: SuggestionView["entryLegs"] = stored.legs.flatMap((leg, index) => {
    const entryPrice = legs[index]?.price;
    return entryPrice
      ? [{ role: leg.role, side: leg.side, ticker: leg.ticker, quantity: leg.quantity, entryPrice }]
      : [];
  });

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
