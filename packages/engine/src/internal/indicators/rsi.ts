import Decimal from "decimal.js";
import { assertPresent } from "../invariant";

type Averages = { gain: Decimal; loss: Decimal };

export function rsi(closes: readonly Decimal[], length: number): (Decimal | null)[] {
  const result: (Decimal | null)[] = closes.map(() => null);
  wilderAverages(closes, length, (index, averages) => {
    result[index] = rsiFromAverages(averages);
  });
  return result;
}

// rsi(closes, length).at(-1) without the RSI of every earlier bar: a trailing-window reading
// (ADR-0048) only needs the last one.
export function lastRsi(closes: readonly Decimal[], length: number): Decimal | null {
  const averages = wilderAverages(closes, length, () => undefined);
  return averages ? rsiFromAverages(averages) : null;
}

function wilderAverages(
  closes: readonly Decimal[],
  length: number,
  visit: (index: number, averages: Averages) => void,
): Averages | null {
  if (closes.length <= length) return null;

  const changes: Decimal[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const current = assertPresent(closes[i], "rsi: missing close at i");
    const previous = assertPresent(closes[i - 1], "rsi: missing close at i - 1");
    changes.push(current.sub(previous));
  }

  const zero = new Decimal(0);
  const gain = (change: Decimal): Decimal => (change.gt(0) ? change : zero);
  const loss = (change: Decimal): Decimal => (change.lt(0) ? change.neg() : zero);

  let averages: Averages = {
    gain: changes
      .slice(0, length)
      .reduce((acc, c) => acc.add(gain(c)), zero)
      .div(length),
    loss: changes
      .slice(0, length)
      .reduce((acc, c) => acc.add(loss(c)), zero)
      .div(length),
  };
  visit(length, averages);

  for (let i = length; i < changes.length; i += 1) {
    const change = assertPresent(changes[i], "rsi: missing change at i");
    averages = {
      gain: averages.gain
        .mul(length - 1)
        .add(gain(change))
        .div(length),
      loss: averages.loss
        .mul(length - 1)
        .add(loss(change))
        .div(length),
    };
    visit(i + 1, averages);
  }

  return averages;
}

function rsiFromAverages({ gain, loss }: Averages): Decimal | null {
  if (gain.isZero() && loss.isZero()) return null;
  if (loss.isZero()) return new Decimal(100);
  const rs = gain.div(loss);
  return new Decimal(100).sub(new Decimal(100).div(new Decimal(1).add(rs)));
}
