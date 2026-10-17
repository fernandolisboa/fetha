// A dd/mm/yyyy label in 11px mono (10 characters at 7px) plus the gap that keeps neighbours apart.
export const DATE_TICK_SPACING = 96;

// How many tick labels fit along an axis `length` pixels long when each label needs `spacing`
// pixels; the two end ticks sit on the axis ends, so a short axis still gets both.
export function ticksThatFit(length: number, spacing: number, max: number): number {
  return Math.max(2, Math.min(max, Math.floor(length / spacing) + 1));
}

// At most `count` values from `values`, a whole number of steps apart so neighbouring labels never
// sit closer than one step, always keeping the first and the last.
export function evenlySpaced<T>(values: readonly T[], count: number): T[] {
  if (values.length <= count) return [...values];
  const last = values.length - 1;
  const stride = Math.ceil(last / Math.max(1, count - 1));
  const indexes: number[] = [];
  for (let index = 0; last - index >= stride; index += stride) {
    indexes.push(index);
  }
  indexes.push(last);
  return indexes.map((index) => values[index] as T);
}
