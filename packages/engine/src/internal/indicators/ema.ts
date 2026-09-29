import Decimal from "decimal.js";
import { assertPresent } from "../invariant";

export function ema(closes: readonly Decimal[], length: number): (Decimal | null)[] {
  const result: (Decimal | null)[] = closes.map(() => null);
  if (closes.length < length) return result;
  const k = new Decimal(2).div(length + 1);
  let previous = closes
    .slice(0, length)
    .reduce((acc, v) => acc.add(v), new Decimal(0))
    .div(length);
  result[length - 1] = previous;
  for (let i = length; i < closes.length; i += 1) {
    const close = assertPresent(closes[i], "ema: missing close at i");
    previous = close.sub(previous).mul(k).add(previous);
    result[i] = previous;
  }
  return result;
}
