import Decimal from "decimal.js";

export function sma(closes: readonly Decimal[], length: number): (Decimal | null)[] {
  return closes.map((_, i) => {
    if (i < length - 1) return null;
    const window = closes.slice(i - length + 1, i + 1);
    return window.reduce((acc, v) => acc.add(v), new Decimal(0)).div(length);
  });
}
