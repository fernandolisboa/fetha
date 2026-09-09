import Decimal from "decimal.js";
import { assertPresent } from "../invariant";

export function rsi(closes: readonly Decimal[], length: number): (Decimal | null)[] {
  const result: (Decimal | null)[] = closes.map(() => null);
  if (closes.length <= length) return result;

  const changes: Decimal[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const current = assertPresent(closes[i], "rsi: missing close at i");
    const previous = assertPresent(closes[i - 1], "rsi: missing close at i - 1");
    changes.push(current.sub(previous));
  }

  const zero = new Decimal(0);
  const gain = (change: Decimal): Decimal => (change.gt(0) ? change : zero);
  const loss = (change: Decimal): Decimal => (change.lt(0) ? change.neg() : zero);

  let avgGain = changes
    .slice(0, length)
    .reduce((acc, c) => acc.add(gain(c)), zero)
    .div(length);
  let avgLoss = changes
    .slice(0, length)
    .reduce((acc, c) => acc.add(loss(c)), zero)
    .div(length);
  result[length] = rsiFromAverages(avgGain, avgLoss);

  for (let i = length; i < changes.length; i += 1) {
    const change = assertPresent(changes[i], "rsi: missing change at i");
    avgGain = avgGain
      .mul(length - 1)
      .add(gain(change))
      .div(length);
    avgLoss = avgLoss
      .mul(length - 1)
      .add(loss(change))
      .div(length);
    result[i + 1] = rsiFromAverages(avgGain, avgLoss);
  }

  return result;
}

function rsiFromAverages(avgGain: Decimal, avgLoss: Decimal): Decimal | null {
  if (avgGain.isZero() && avgLoss.isZero()) return null;
  if (avgLoss.isZero()) return new Decimal(100);
  const rs = avgGain.div(avgLoss);
  return new Decimal(100).sub(new Decimal(100).div(new Decimal(1).add(rs)));
}
