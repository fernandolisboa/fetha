import type { Centavos } from "@fetha/contracts";

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
