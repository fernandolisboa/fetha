import { decimalStringSchema, type DecimalString } from "@fetha/contracts";

import { parsePtBrDecimal } from "@/lib/format/parse-decimal";

// Six decimals, the precision `fills.price` stores. Zero is a price only
// where a settlement closes an option leg at nothing.
export function parsePriceInput(
  raw: string,
  { allowZero = false }: { allowZero?: boolean } = {},
): DecimalString | null {
  const decimal = parsePtBrDecimal(raw, 6);
  if (!decimal || (decimal.isZero() && !allowZero)) {
    return null;
  }
  return decimalStringSchema.parse(decimal.toFixed());
}
