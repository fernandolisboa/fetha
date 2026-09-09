import type { DecimalString } from "@fetha/contracts";

export function decimalString(value: string): DecimalString {
  return value as DecimalString;
}
