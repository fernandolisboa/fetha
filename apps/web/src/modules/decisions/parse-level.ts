import { Decimal } from "decimal.js";
import { positiveDecimalSchema, type DecimalString } from "@fetha/contracts";

// pt-BR decimal input for a thesis claim's level ("close_above"/"close_below"
// a price): same shape as `lib/format/parse-money.ts#parseCentavosInput` but
// for a plain price, not money (no cents rounding, no thousands-separator
// requirement below 1000).
const PT_BR_DECIMAL = /^\d{1,3}(\.\d{3})*(,\d{1,4})?$|^\d+(,\d{1,4})?$/;

export function parseLevelInput(raw: string): DecimalString | null {
  const trimmed = raw.trim();
  if (!PT_BR_DECIMAL.test(trimmed)) {
    return null;
  }
  const normalized = trimmed.replaceAll(".", "").replace(",", ".");
  const decimal = new Decimal(normalized);
  const result = positiveDecimalSchema.safeParse(decimal.toFixed());
  return result.success ? result.data : null;
}
