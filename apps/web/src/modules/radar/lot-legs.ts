import type { DecimalString } from "@fetha/contracts";
import type { Leg } from "@fetha/engine";

import type { RadarLeg } from "./match";

export interface LotLeg extends RadarLeg {
  quantity: number;
  price: DecimalString;
}

// The lot's legs with the series each resolved to, paired by position; null when a leg has no
// price, the radar legs fall short or one does not name the same ticker (a stored row an older
// shape wrote).
export function lotLegsOf(
  legs: readonly Pick<Leg, "ticker" | "quantity">[],
  prices: readonly (DecimalString | null)[],
  radarLegs: readonly RadarLeg[],
): LotLeg[] | null {
  const paired: LotLeg[] = [];
  for (const [index, leg] of legs.entries()) {
    const price = prices[index] ?? null;
    const radarLeg = radarLegs[index];
    if (price === null || !radarLeg || radarLeg.ticker !== leg.ticker) return null;
    paired.push({ ...radarLeg, quantity: leg.quantity, price });
  }
  return paired;
}
