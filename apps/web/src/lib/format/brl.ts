import { Decimal } from "decimal.js";
import { centavosSchema, type Centavos, type DecimalString } from "@fetha/contracts";

const MINUS_SIGN = "−";

export function formatBRL(centavos: Centavos): string {
  const isNegative = centavos < 0;
  const absoluteCentavos = Math.abs(centavos);
  const reais = Math.floor(absoluteCentavos / 100);
  const cents = absoluteCentavos % 100;
  const reaisWithSeparators = reais.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const centsPadded = cents.toString().padStart(2, "0");
  const sign = isNegative ? MINUS_SIGN : "";
  return `${sign}R$ ${reaisWithSeparators},${centsPadded}`;
}

// Instrument prices (a candle close, not a money amount) carry more decimal
// places than centavos can hold; rounding half up to the nearest centavo
// only at the display boundary keeps the underlying decimal-string data
// exact end to end (CLAUDE.md: prices as decimal.js, never JS `number`).
export function formatPriceBRL(price: DecimalString): string {
  const centavos = new Decimal(price).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return formatBRL(centavos.toNumber() as Centavos);
}

// Parses a pt-BR money input ("1.234,56" or "1234,56" or "1234") into
// centavos; returns null for anything that is not a positive amount, since
// the only caller (declared capital) never accepts zero or negative money.
// Decimal, not floating-point multiplication (ADR-0001: never JS `number`
// for money), so an input on the edge of a centavo never rounds wrong.
export function parseBRLToCentavos(input: string): Centavos | null {
  const trimmed = input.trim().replace(/\./g, "").replace(",", ".");
  if (trimmed === "" || !/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = new Decimal(trimmed);
  if (value.isZero() || value.isNegative()) return null;
  const centavos = value.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const result = centavosSchema.safeParse(centavos.toNumber());
  return result.success ? result.data : null;
}
