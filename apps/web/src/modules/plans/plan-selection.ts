import {
  quantitySchema,
  type Quantity,
  type Recipe,
  type Structure,
  type Ticker,
} from "@fetha/contracts";
import type { LegSelection } from "@fetha/engine";

// B3's standard lot for stock options (docs/adr/0067), the unit a plan sizes in.
export const PLAN_LOT: Quantity = quantitySchema.parse(100);

// The plan's own series rule (ticket #379), independent of a recipe's own (narrower)
// expiry window: a monthly cycle, at least 20 sessions ahead so the plan is never pinned
// against a decaying near expiry, and no further than ten weeks out.
export const PLAN_MIN_SESSIONS_AHEAD = 20;
export const PLAN_MAX_SESSIONS_AHEAD = 50;

// The engine's own selection (ADR-0013's frozen `priceOperation`) resolves this against the
// chain: only a series that traded at the underlying's last close is ever picked, by the
// recipe's own strike rule, at `lots` standard lots.
export function legSelectionFor(
  recipe: Recipe,
  structure: Structure,
  underlying: Ticker,
  lots: number,
): LegSelection {
  return {
    structure,
    underlying,
    strikes: recipe.definition.strikes,
    expiry: { kind: "business_days", min: PLAN_MIN_SESSIONS_AHEAD, max: PLAN_MAX_SESSIONS_AHEAD },
    quantity: quantitySchema.parse(PLAN_LOT * lots),
  };
}
