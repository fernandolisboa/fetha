import { decimalStringSchema, type StrikeSelection, type Structure } from "@fetha/contracts";

const atTheMoney: StrikeSelection = { kind: "moneyness", percent: decimalStringSchema.parse("0") };

export function strikesFittedTo(
  structure: Structure,
  strikes: readonly StrikeSelection[],
): StrikeSelection[] {
  const ranks = new Set(
    structure.legs.flatMap((leg) => (leg.role === "stock" ? [] : [leg.strikeRank])),
  );
  return Array.from({ length: ranks.size }, (_, index) => strikes[index] ?? atTheMoney);
}
