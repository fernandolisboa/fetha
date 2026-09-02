export type Money = {
  amountCentavos: number;
  currency: "BRL";
};

export class NonIntegerAmountError extends Error {
  readonly amountCentavos: number;

  constructor(amountCentavos: number) {
    super(
      `Money amounts must be an integer number of centavos, received ${String(amountCentavos)}`,
    );
    this.name = "NonIntegerAmountError";
    this.amountCentavos = amountCentavos;
  }
}

function assertIntegerAmount(amountCentavos: number): void {
  if (!Number.isInteger(amountCentavos)) {
    throw new NonIntegerAmountError(amountCentavos);
  }
}

export function add(a: Money, b: Money): Money {
  assertIntegerAmount(a.amountCentavos);
  assertIntegerAmount(b.amountCentavos);
  return { amountCentavos: a.amountCentavos + b.amountCentavos, currency: "BRL" };
}

export function subtract(a: Money, b: Money): Money {
  assertIntegerAmount(a.amountCentavos);
  assertIntegerAmount(b.amountCentavos);
  return { amountCentavos: a.amountCentavos - b.amountCentavos, currency: "BRL" };
}

export function formatBRL(money: Money): string {
  assertIntegerAmount(money.amountCentavos);
  const isNegative = money.amountCentavos < 0;
  const absoluteCentavos = Math.abs(money.amountCentavos);
  const reais = Math.floor(absoluteCentavos / 100);
  const centavos = absoluteCentavos % 100;
  const reaisWithSeparators = reais.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const centavosPadded = centavos.toString().padStart(2, "0");
  const sign = isNegative ? "-" : "";
  return `${sign}R$ ${reaisWithSeparators},${centavosPadded}`;
}
