import { Decimal } from "decimal.js";

// pt-BR decimal input, `.` thousands separator, `,` decimal separator. This
// app has exactly one locale, so `10.000` is ten thousand, never ten with
// three decimals: `Number("10.000".replace(",", "."))` silently parsed it as
// `10`, the bug this guards.
export function parsePtBrDecimal(raw: string, maxDecimals: number): Decimal | null {
  const decimals = `(,\\d{1,${String(maxDecimals)}})?`;
  const shape = new RegExp(`^\\d{1,3}(\\.\\d{3})*${decimals}$|^\\d+${decimals}$`);
  const trimmed = raw.trim();
  if (!shape.test(trimmed)) {
    return null;
  }
  return new Decimal(trimmed.replaceAll(".", "").replace(",", "."));
}
