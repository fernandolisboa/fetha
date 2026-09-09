import Decimal from "decimal.js";
import { assertPresent } from "../invariant";
import { sma } from "./sma";

export function ema(closes: readonly Decimal[], length: number): (Decimal | null)[] {
  const seeded = sma(closes, length);
  const k = new Decimal(2).div(length + 1);
  const result: (Decimal | null)[] = [...seeded];
  for (let i = length; i < closes.length; i += 1) {
    const previous = assertPresent(result[i - 1], "ema: missing seed at i - 1");
    const close = assertPresent(closes[i], "ema: missing close at i");
    result[i] = close.sub(previous).mul(k).add(previous);
  }
  return result;
}
