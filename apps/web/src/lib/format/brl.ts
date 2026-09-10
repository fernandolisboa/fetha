import { Decimal } from "decimal.js";
import type { Centavos, DecimalString } from "@fetha/contracts";

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
