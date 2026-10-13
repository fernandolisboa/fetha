import type { StrikeSelection, Structure } from "@fetha/contracts";

export type SketchPoint = { x: number; y: number };

const REFERENCE_SPOT = 100;
const RANGE = 20;
const SAMPLES = 81;

function strikesOf(strikes: readonly StrikeSelection[]): number[] {
  if (strikes.every((strike) => strike.kind === "moneyness")) {
    return strikes.map((strike) => REFERENCE_SPOT * (1 + Number(strike.percent)));
  }
  const middle = (strikes.length + 1) / 2;
  return strikes.map((_strike, index) => REFERENCE_SPOT + 5 * (index + 1 - middle));
}

// A picture of the shape at expiry, not a figure: the premium is unknown
// here, so the curve is the legs' intrinsic value minus its own mean over the
// drawn range. That keeps both the gain and the loss side visible for debit
// and credit structures alike; real numbers come from the engine once the
// recipe is backtested or priced in the operation builder.
export function payoffSketch(
  structure: Structure,
  strikes: readonly StrikeSelection[],
): SketchPoint[] {
  const strikePrices = strikesOf(strikes);
  const spots = Array.from(
    { length: SAMPLES },
    (_value, index) => REFERENCE_SPOT - RANGE + (2 * RANGE * index) / (SAMPLES - 1),
  );
  const intrinsic = spots.map((spot) =>
    structure.legs.reduce((sum, leg) => {
      const sign = leg.side === "buy" ? 1 : -1;
      if (leg.role === "stock") {
        return sum + sign * leg.ratio * (spot - REFERENCE_SPOT);
      }
      const strike = strikePrices[leg.strikeRank - 1] ?? REFERENCE_SPOT;
      const value = leg.role === "call" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
      return sum + sign * leg.ratio * value;
    }, 0),
  );
  const mean = intrinsic.reduce((sum, value) => sum + value, 0) / intrinsic.length;
  const centred = intrinsic.map((value) => value - mean);
  const scale = Math.max(...centred.map((value) => Math.abs(value)), Number.EPSILON);
  return centred.map((value, index) => ({ x: index / (SAMPLES - 1), y: value / scale }));
}
