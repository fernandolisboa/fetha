import { Decimal } from "decimal.js";
import type { Centavos } from "@fetha/contracts";

// pt-BR money input, `.` thousands separator, `,` decimal separator: only
// ADR-0001's "never a JavaScript number for money" shape is accepted.
// `10.000` is ten thousand reais here, never ten with three decimals (this
// app has exactly one locale) — `Number("10.000".replace(",", "."))`
// silently parsed it as `10`, the bug this guards.
const PT_BR_MONEY = /^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/;

export function parseCentavosInput(raw: string): Centavos | null {
  const trimmed = raw.trim();
  if (!PT_BR_MONEY.test(trimmed)) {
    return null;
  }
  const normalized = trimmed.replaceAll(".", "").replace(",", ".");
  const decimal = new Decimal(normalized).times(100);
  if (!decimal.isInteger()) {
    return null;
  }
  return decimal.toNumber() as Centavos;
}
