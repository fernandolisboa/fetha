import { Decimal } from "decimal.js";
import { decimalStringSchema, type DecimalString } from "@fetha/contracts";

// pt-BR price input for a fill (`38,42`, `1.234,5`): up to six decimals,
// the precision `fills.price` stores. Zero is a price only where a
// settlement closes an option leg at nothing.
const PT_BR_PRICE = /^\d{1,3}(\.\d{3})*(,\d{1,6})?$|^\d+(,\d{1,6})?$/;

export function parsePriceInput(
  raw: string,
  { allowZero = false }: { allowZero?: boolean } = {},
): DecimalString | null {
  const trimmed = raw.trim();
  if (!PT_BR_PRICE.test(trimmed)) {
    return null;
  }
  const decimal = new Decimal(trimmed.replaceAll(".", "").replace(",", "."));
  if (decimal.isZero() && !allowZero) {
    return null;
  }
  return decimalStringSchema.parse(decimal.toFixed());
}
