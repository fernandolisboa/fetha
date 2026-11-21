import type { DecimalString, SessionDate, Ticker } from "@fetha/contracts";

import type { PlanChainEntry } from "./chain-view";
import { snapToStrike } from "./strike-snap";

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

// One step of a leg's strike (ticket #380, the native range input and the ← → buttons behind
// it): moves to the next or previous traded strike in the sorted list, clamped at either end —
// `direction` mirrors `stepLots`'s own `1 | -1`.
export function stepStrike(
  strikes: readonly PlanChainEntry[],
  currentTicker: Ticker,
  direction: 1 | -1,
): Ticker | null {
  if (strikes.length === 0) return null;
  const index = indexOfTicker(strikes, currentTicker);
  const nextIndex = Math.max(
    0,
    Math.min(strikes.length - 1, (index === -1 ? 0 : index) + direction),
  );
  return strikes[nextIndex]?.ticker ?? null;
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
