import type { ChainSeries } from "@/modules/market-data";
import type { ContemplatedLeg, Structure } from "@fetha/contracts";

export type LegValidationFailure =
  "leg_count" | "leg_shape" | "unresolved_instrument" | "expiry_mismatch" | "strike_order";

// Checks a builder's concrete legs against the structure template they
// claim to instantiate before pricing or saving them (round 1 item 10):
// same role/side in the same order as the template, every option leg
// resolved against the closing chain, one shared expiry across all option
// legs, and strikes non-decreasing with `strikeRank` — the shape that
// tells a collar's put from its call and a bull spread from a bear spread.
export function validateLegsAgainstStructure(
  structure: Structure,
  legs: ContemplatedLeg[],
  chain: readonly ChainSeries[],
): { ok: true } | { ok: false; reason: LegValidationFailure } {
  if (legs.length !== structure.legs.length) {
    return { ok: false, reason: "leg_count" };
  }

  const chainByTicker = new Map(chain.map((series) => [series.ticker, series]));
  const expiries = new Set<string>();
  const strikeByRank = new Map<number, number>();

  for (let index = 0; index < structure.legs.length; index += 1) {
    const template = structure.legs[index];
    const leg = legs[index];
    if (!template || !leg) {
      return { ok: false, reason: "leg_count" };
    }
    if (template.role !== leg.role || template.side !== leg.side) {
      return { ok: false, reason: "leg_shape" };
    }
    if (template.role === "stock") {
      continue;
    }

    const series = chainByTicker.get(leg.ticker);
    if (!series || series.right !== template.role) {
      return { ok: false, reason: "unresolved_instrument" };
    }

    expiries.add(series.expiry);
    const strike = Number(series.strike);
    const existingStrike = strikeByRank.get(template.strikeRank);
    if (existingStrike !== undefined && existingStrike !== strike) {
      return { ok: false, reason: "strike_order" };
    }
    strikeByRank.set(template.strikeRank, strike);
  }

  if (expiries.size > 1) {
    return { ok: false, reason: "expiry_mismatch" };
  }

  const ranksAscending = [...strikeByRank.keys()].sort((a, b) => a - b);
  for (let index = 1; index < ranksAscending.length; index += 1) {
    const previousRank = ranksAscending[index - 1];
    const rank = ranksAscending[index];
    if (previousRank === undefined || rank === undefined) continue;
    const previousStrike = strikeByRank.get(previousRank);
    const strike = strikeByRank.get(rank);
    if (previousStrike === undefined || strike === undefined || previousStrike > strike) {
      return { ok: false, reason: "strike_order" };
    }
  }

  return { ok: true };
}
