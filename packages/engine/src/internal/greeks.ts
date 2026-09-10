import type { Greeks } from "../api";
import { ZERO_RATIO } from "./decimal";

// Shared by price-operation.ts and mark-to-market.ts (round 1 item 12), both of which
// aggregate the same five Greek fields the same way.
export const GREEK_KEYS = [
  "delta",
  "gamma",
  "theta",
  "vega",
  "rho",
] as const satisfies readonly (keyof Greeks)[];

export const zeroGreeks: Greeks = {
  delta: ZERO_RATIO,
  gamma: ZERO_RATIO,
  theta: ZERO_RATIO,
  vega: ZERO_RATIO,
  rho: ZERO_RATIO,
};
