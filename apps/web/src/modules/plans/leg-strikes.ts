import type { DecimalString, SessionDate, Ticker } from "@fetha/contracts";

import type { PlanChainEntry } from "./chain-view";
import { snapToStrike } from "./strike-snap";
import type { OptionLegTemplate } from "./template-legs";

// The strikes a drag handle or a leg's ← → buttons may land a given leg on (ticket #380): only
// the traded series of that leg's own right, at the plan's currently chosen expiry, sorted by
// strike — an untraded strike (dimmed on the chart) is never a candidate here, consistent with
// the plan's own traded-series filter (`traded-series.ts`) rather than a separate rule.
export function selectableStrikes(
  chain: readonly PlanChainEntry[],
  right: "call" | "put",
  expiry: SessionDate,
): PlanChainEntry[] {
  return chain
    .filter((entry) => entry.traded && entry.right === right && entry.expiry === expiry)
    .sort((a, b) => Number(a.strike) - Number(b.strike));
}

export function indexOfTicker(strikes: readonly PlanChainEntry[], ticker: Ticker): number {
  return strikes.findIndex((entry) => entry.ticker === ticker);
}

// Every listed strike of a leg's right and expiry, traded or not (ticket #380's own chart
// handle): unlike `selectableStrikes`, this keeps the untraded ones in — they render as dimmed
// ticks along the price axis, a handle may pass over them while dragging, but `selectableStrikes`
// stays the only list a drag or a step may actually land on.
export function allStrikesFor(
  chain: readonly PlanChainEntry[],
  right: "call" | "put",
  expiry: SessionDate,
): PlanChainEntry[] {
  return chain
    .filter((entry) => entry.right === right && entry.expiry === expiry)
    .sort((a, b) => Number(a.strike) - Number(b.strike));
}

// Resolves the chart handle's own snapped numeric strike (ticket #380, `nearestStrikeAtPixel`'s
// own return value) back to the listed ticker at that exact price — the handle only ever snaps
// to a candidate already drawn from `strikes`' own values, so this is always found in practice.
export function tickerAtStrike(strikes: readonly PlanChainEntry[], value: number): Ticker | null {
  return strikes.find((entry) => Number(entry.strike) === value)?.ticker ?? null;
}

// One step of a leg's strike (ticket #380, the native range input and the ← → buttons behind
// it): moves to the next or previous traded strike in the sorted list, clamped at either end —
// `direction` mirrors `stepLots`'s own `1 | -1`. Returns null for a ticker not in `strikes` at
// all (round 4 review item 8: an expiry switch that could not remap every leg must never leave
// one of them silently stepping from the wrong end of a since-abandoned list).
export function stepStrike(
  strikes: readonly PlanChainEntry[],
  currentTicker: Ticker,
  direction: 1 | -1,
): Ticker | null {
  if (strikes.length === 0) return null;
  const index = indexOfTicker(strikes, currentTicker);
  if (index === -1) return null;
  const nextIndex = Math.max(0, Math.min(strikes.length - 1, index + direction));
  return strikes[nextIndex]?.ticker ?? null;
}

// Narrows a leg's own candidate strikes to strictly between its neighbouring ranks' current
// strikes (round 4 review item 4's UI half): a handle or the ← → buttons may never cross, or
// land on, the strike of the rank immediately below or above this one — crossing would no
// longer be the structure the recipe describes (ADR-0079), and the server's own
// `validateStructuralAdjustment` would refuse it anyway. Either bound absent (no neighbour on
// that side) leaves that side unrestricted.
export function boundedStrikes(
  strikes: readonly PlanChainEntry[],
  lowerBound: number | null,
  upperBound: number | null,
): PlanChainEntry[] {
  return strikes.filter((entry) => {
    const value = Number(entry.strike);
    if (lowerBound !== null && value <= lowerBound) return false;
    if (upperBound !== null && value >= upperBound) return false;
    return true;
  });
}

export interface RankBound {
  lower: number | null;
  upper: number | null;
}

// One rank bound per option leg, in template order (round 4 review item 4): for a leg at
// `strikeRank`, the lower bound is the greatest current strike among legs at a lower rank, the
// upper bound the smallest current strike among legs at a higher rank — legs sharing the same
// rank (a box spread's own paired call/put at one strike) bound neither side of each other.
// `strikeOf` resolves another leg's own current strike by its position in `legs`; null when
// that leg's own ticker has no resolved series yet.
export function rankBoundsFor(
  legs: readonly OptionLegTemplate[],
  strikeOf: (index: number) => number | null,
): RankBound[] {
  return legs.map((leg, index) => {
    let lower: number | null = null;
    let upper: number | null = null;
    for (const [otherIndex, other] of legs.entries()) {
      if (otherIndex === index) continue;
      const strike = strikeOf(otherIndex);
      if (strike === null) continue;
      if (other.strikeRank < leg.strikeRank) {
        lower = lower === null ? strike : Math.max(lower, strike);
      } else if (other.strikeRank > leg.strikeRank) {
        upper = upper === null ? strike : Math.min(upper, strike);
      }
    }
    return { lower, upper };
  });
}

// Remaps a leg from one expiry's chain to the nearest strike of a newly chosen expiry (an
// expiry chip, ticket #380): the two chains rarely list the exact same strikes, so this snaps
// by raw strike price (`snapToStrike`) rather than by index, which could land on an
// economically unrelated strike.
export function remapToExpiry(
  chain: readonly PlanChainEntry[],
  right: "call" | "put",
  currentStrike: DecimalString,
  newExpiry: SessionDate,
): Ticker | null {
  const candidates = selectableStrikes(chain, right, newExpiry);
  const strike = snapToStrike(
    candidates.map((entry) => entry.strike),
    Number(currentStrike),
  );
  if (strike === null) return null;
  return candidates.find((entry) => entry.strike === strike)?.ticker ?? null;
}
