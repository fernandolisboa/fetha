import { assertDefined } from "./invariant";

// The number of leading entries of an ascending array that are <= `value`: the insertion point
// after every equal entry. A NaN `value` is never >= anything, so it yields 0.
export function upperBound(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (assertDefined(sorted[mid], "upperBound: index within bounds") <= value) low = mid + 1;
    else high = mid;
  }
  return low;
}
