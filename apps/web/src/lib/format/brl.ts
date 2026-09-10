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
export function parseBRLToCentavos(input: string): Centavos | null {
  const trimmed = input.trim().replace(/\./g, "").replace(",", ".");
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  const result = centavosSchema.safeParse(Math.round(value * 100));
  return result.success ? result.data : null;
}
