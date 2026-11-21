import type { SessionDate, Ticker } from "@fetha/contracts";

import type { PlanLegSeries } from "./actions";
import type { PlanChainEntry } from "./chain-view";
import {
  commonSelectableStrikes,
  selectableStrikes,
  tickerAtStrike,
  type RankGroup,
} from "./leg-strikes";
import type { PlanDiffLeg } from "./plan-diff";
import { snapToStrike } from "./strike-snap";
import type { OptionLegTemplate } from "./template-legs";

// Everything a strike rank's edit needs to resolve itself against (ticket #380): the chain, the
// plan's currently chosen expiry, the structure's own template legs (for each rank's right),
// the full-array position of every template leg (a stock leg has none), the plan's own legs in
// that same full-array order, and every leg's own listed series (for its current strike). Pure:
// no React, no I/O — the component only ever builds this from its own state and reads the
// result back.
export interface RankEditContext {
  chain: readonly PlanChainEntry[];
  expiry: SessionDate | null;
  templateLegs: readonly OptionLegTemplate[];
  optionFullIndices: readonly number[];
  legs: readonly PlanDiffLeg[];
  seriesByTicker: Readonly<Record<Ticker, PlanLegSeries | undefined>>;
}

function rightsOfRank(
  rank: RankGroup,
  templateLegs: readonly OptionLegTemplate[],
): ("call" | "put")[] {
  return [
    ...new Set(
      rank.legIndices
        .map((templateIndex) => templateLegs[templateIndex]?.role)
        .filter((right): right is "call" | "put" => right !== undefined),
    ),
  ];
}

// The listed series a rank's own display reads from — every leg at a rank shares one strike, so
// any one of them stands in for the rank.
export function seriesOfRank(context: RankEditContext, rank: RankGroup): PlanLegSeries | null {
  const templateIndex = rank.legIndices[0];
  const fullIndex =
    templateIndex === undefined ? undefined : context.optionFullIndices[templateIndex];
  const leg = fullIndex === undefined ? undefined : context.legs[fullIndex];
  return leg ? (context.seriesByTicker[leg.ticker] ?? null) : null;
}

// The current strike every leg of a rank shares, read from the plan's own listed series — null
// when any of this rank's legs has nothing resolved yet.
export function currentStrikeOfRank(context: RankEditContext, rank: RankGroup): number | null {
  const series = seriesOfRank(context, rank);
  return series ? Number(series.strike) : null;
}

// Resolves every leg of a rank to its own ticker at a shared next strike value, one per right
// present at that rank (a straddle's call and put move together) — null if any of them has no
// listed series there, so a rank edit is always all-or-nothing, never partial.
export function tickersForRank(
  context: RankEditContext,
  rank: RankGroup,
  strikeValue: number,
): Map<number, Ticker> | null {
  if (!context.expiry) return null;
  const updates = new Map<number, Ticker>();
  for (const templateIndex of rank.legIndices) {
    const fullIndex = context.optionFullIndices[templateIndex];
    const right = context.templateLegs[templateIndex]?.role;
    if (fullIndex === undefined || !right) return null;
    const ticker = tickerAtStrike(
      selectableStrikes(context.chain, right, context.expiry),
      strikeValue,
    );
    if (!ticker) return null;
    updates.set(fullIndex, ticker);
  }
  return updates;
}

// Applies every leg's own next ticker at once (ticket #380): a strike rank shared by more than
// one right (a straddle's call and put) always moves together, never one leg at a time, so an
// edit is always expressed as a full map of full-array index to its next ticker.
export function legsWithChanges(
  legs: readonly PlanDiffLeg[],
  updates: ReadonlyMap<number, Ticker>,
): PlanDiffLeg[] {
  return legs.map((leg, index) => {
    const nextTicker = updates.get(index);
    return nextTicker ? { ...leg, ticker: nextTicker } : leg;
  });
}

// The rank-change application itself: resolves a rank's new strike to every leg's own ticker and
// applies it, or null if the edit cannot land (one of the rank's rights is not traded at that
// strike) — the one function both a chart-handle release and a ← → step call.
export function nextLegsForRankStrike(
  context: RankEditContext,
  rank: RankGroup,
  strikeValue: number,
): PlanDiffLeg[] | null {
  const updates = tickersForRank(context, rank, strikeValue);
  if (!updates) return null;
  return legsWithChanges(context.legs, updates);
}

// An expiry chip's own per-rank remap (ticket #380): snaps a rank's current strike once over the
// candidates traded for every right at that rank in the new expiry (`commonSelectableStrikes`),
// then applies that one snapped strike to every leg of the rank together — never one leg
// snapping independently of the other, which could land a straddle's call and put on two
// different strikes. Null when the rank has no strike traded for every one of its rights in the
// new expiry.
export function nextLegsForRankExpiry(
  context: RankEditContext,
  rank: RankGroup,
  nextExpiry: SessionDate,
): PlanDiffLeg[] | null {
  const series = seriesOfRank(context, rank);
  if (!series) return null;
  const rights = rightsOfRank(rank, context.templateLegs);
  const candidates = commonSelectableStrikes(context.chain, rights, nextExpiry);
  const strike = snapToStrike(
    candidates.map((entry) => entry.strike),
    Number(series.strike),
  );
  if (strike === null) return null;
  return nextLegsForRankStrike({ ...context, expiry: nextExpiry }, rank, Number(strike));
}
