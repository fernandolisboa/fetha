import Decimal from "decimal.js";
import { assertPresent } from "../invariant";

export type AtrBar = { high: Decimal; low: Decimal; close: Decimal };

export function atr(bars: readonly AtrBar[], length: number): (Decimal | null)[] {
  const result: (Decimal | null)[] = bars.map(() => null);
  if (bars.length <= length) return result;

  const trueRanges: Decimal[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const bar = assertPresent(bars[i], "atr: missing bar at i");
    const prevClose = assertPresent(bars[i - 1], "atr: missing bar at i - 1").close;
    trueRanges.push(
      Decimal.max(
        bar.high.sub(bar.low),
        bar.high.sub(prevClose).abs(),
        bar.low.sub(prevClose).abs(),
      ),
    );
  }

  let value = trueRanges
    .slice(0, length)
    .reduce((acc, tr) => acc.add(tr), new Decimal(0))
    .div(length);
  result[length] = value;

  for (let i = length; i < trueRanges.length; i += 1) {
    const trueRange = assertPresent(trueRanges[i], "atr: missing true range at i");
    value = value
      .mul(length - 1)
      .add(trueRange)
      .div(length);
    result[i + 1] = value;
  }

  return result;
}
