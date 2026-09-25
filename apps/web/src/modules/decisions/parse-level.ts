import { positiveDecimalSchema, type DecimalString } from "@fetha/contracts";

import { parsePtBrDecimal } from "@/lib/format/parse-decimal";

export function parseLevelInput(raw: string): DecimalString | null {
  const decimal = parsePtBrDecimal(raw, 4);
  if (!decimal) {
    return null;
  }
  const result = positiveDecimalSchema.safeParse(decimal.toFixed());
  return result.success ? result.data : null;
}
