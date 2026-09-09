export class NonIntegerCentavosError extends Error {
  readonly centavos: number;

  constructor(centavos: number) {
    super(`BRL amounts must be an integer number of centavos, received ${String(centavos)}`);
    this.name = "NonIntegerCentavosError";
    this.centavos = centavos;
  }
}

const MINUS_SIGN = "−";

export function formatBRL(centavos: number): string {
  if (!Number.isInteger(centavos)) {
    throw new NonIntegerCentavosError(centavos);
  }
  const isNegative = centavos < 0;
  const absoluteCentavos = Math.abs(centavos);
  const reais = Math.floor(absoluteCentavos / 100);
  const cents = absoluteCentavos % 100;
  const reaisWithSeparators = reais.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const centsPadded = cents.toString().padStart(2, "0");
  const sign = isNegative ? MINUS_SIGN : "";
  return `${sign}R$ ${reaisWithSeparators},${centsPadded}`;
}
