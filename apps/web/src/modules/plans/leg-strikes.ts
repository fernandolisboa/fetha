import type { DecimalString, SessionDate, Ticker } from "@fetha/contracts";

import type { PlanChainEntry } from "./chain-view";
import { snapToStrike } from "./strike-snap";
import type { OptionLegTemplate } from "./template-legs";

// The strikes a drag handle or a rank's ← → buttons may land a given leg on (ticket #380): only
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
// all: an expiry switch that could not remap every leg must never leave one of them silently
// stepping from the wrong end of a since-abandoned list.
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

// The same step, by raw strike value rather than ticker (ticket #380): a strike rank shared by
// more than one right (a straddle's call and put, both at one strike) has no single ticker of
// its own to step from, only the value every leg at that rank must land on together.
export function stepStrikeValue(
  strikes: readonly PlanChainEntry[],
  currentValue: number,
  direction: 1 | -1,
): number | null {
  if (strikes.length === 0) return null;
  const index = strikes.findIndex((entry) => Number(entry.strike) === currentValue);
  if (index === -1) return null;
  const nextIndex = Math.max(0, Math.min(strikes.length - 1, index + direction));
  const next = strikes[nextIndex];
  return next ? Number(next.strike) : null;
}

// Narrows a rank's own candidate strikes to strictly between its neighbouring ranks' current
// strikes: a handle or the ← → buttons may never cross, or land on, the strike of the rank
// immediately below or above this one — crossing would no longer be the structure the recipe
// describes (ADR-0079), and the server's own `validateStructuralAdjustment` would refuse it
// anyway. Either bound absent (no neighbour on that side) leaves that side unrestricted.
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

// One strike bound per entry, in rank order: for an entry at `strikeRank`, the lower bound is
// the greatest current strike among entries at a lower rank, the upper bound the smallest
// current strike among entries at a higher rank — entries sharing the same rank (a straddle's
// own call and put, a box spread's own paired call/put at one strike) bound neither side of
// each other, since they are edited together, never against each other. `strikeOf` resolves
// another entry's own current strike by its position in `entries`; null when that entry's own
// ticker has no resolved series yet.
export function rankBoundsFor(
  entries: readonly { strikeRank: number }[],
  strikeOf: (index: number) => number | null,
): RankBound[] {
  return entries.map((entry, index) => {
    let lower: number | null = null;
    let upper: number | null = null;
    for (const [otherIndex, other] of entries.entries()) {
      if (otherIndex === index) continue;
      const strike = strikeOf(otherIndex);
      if (strike === null) continue;
      if (other.strikeRank < entry.strikeRank) {
        lower = lower === null ? strike : Math.max(lower, strike);
      } else if (other.strikeRank > entry.strikeRank) {
        upper = upper === null ? strike : Math.min(upper, strike);
      }
    }
    return { lower, upper };
  });
}

export interface RankGroup {
  strikeRank: number;
  // Indices into the structure's own `optionLegsOf` array (template order) of every leg
  // sharing this rank.
  legIndices: number[];
}

// Groups a structure's own option legs by strike rank, ascending (ticket #380): legs sharing a
// rank — a straddle's call and put, both bought at the same strike — move together as a single
// strike edit, never one at a time, matching the single shared strike the server's own
// `validateStructuralAdjustment` requires per rank.
export function ranksOf(legs: readonly OptionLegTemplate[]): RankGroup[] {
  const byRank = new Map<number, number[]>();
  legs.forEach((leg, index) => {
    const indices = byRank.get(leg.strikeRank) ?? [];
    indices.push(index);
    byRank.set(leg.strikeRank, indices);
  });
  return [...byRank.entries()]
    .sort(([a], [b]) => a - b)
    .map(([strikeRank, legIndices]) => ({ strikeRank, legIndices }));
}

// The strikes a rank's own handle or ← → buttons may land on: traded for every right present at
// that rank (ticket #380) — a straddle's strike edit must find both a traded call and a traded
// put at the candidate strike, or the server's own per-rank check would refuse the result
// anyway. A rank with only one right reduces to `selectableStrikes`.
export function commonSelectableStrikes(
  chain: readonly PlanChainEntry[],
  rights: readonly ("call" | "put")[],
  expiry: SessionDate,
): PlanChainEntry[] {
  const distinctRights = [...new Set(rights)];
  const [first, ...rest] = distinctRights;
  if (!first) return [];
  const base = selectableStrikes(chain, first, expiry);
  if (rest.length === 0) return base;
  return base.filter((entry) =>
    rest.every((right) =>
      selectableStrikes(chain, right, expiry).some(
        (other) => Number(other.strike) === Number(entry.strike),
      ),
    ),
  );
}

// Every listed strike across a rank's own rights, traded or not (ticket #380's chart handle):
// the union of both rights' own ticks, for the tick marks a handle may pass over while
// dragging — `commonSelectableStrikes` stays the only list a drag or a step may actually land
// on.
export function allStrikesForRank(
  chain: readonly PlanChainEntry[],
  rights: readonly ("call" | "put")[],
  expiry: SessionDate,
): number[] {
  const distinctRights = [...new Set(rights)];
  const values = new Set<number>();
  for (const right of distinctRights) {
    for (const entry of allStrikesFor(chain, right, expiry)) values.add(Number(entry.strike));
  }
  return [...values].sort((a, b) => a - b);
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
