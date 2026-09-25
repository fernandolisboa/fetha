import type { Centavos } from "@fetha/contracts";

import { parsePtBrDecimal } from "./parse-decimal";

// Only ADR-0001's "never a JavaScript number for money" shape is accepted.
export function parseCentavosInput(raw: string): Centavos | null {
  const decimal = parsePtBrDecimal(raw, 2)?.times(100);
  if (!decimal?.isInteger()) {
    return null;
  }
  return decimal.toNumber() as Centavos;
}
