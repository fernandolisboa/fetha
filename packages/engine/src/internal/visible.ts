import type { Instant } from "@fetha/contracts";
import { isAtOrBefore, compareInstants } from "./instant";

export function latestVisible<T extends { asOf: Instant }>(
  rows: readonly T[],
  at: Instant,
): T | null {
  let latest: T | null = null;
  for (const row of rows) {
    if (!isAtOrBefore(row.asOf, at)) continue;
    if (latest === null || compareInstants(row.asOf, latest.asOf) > 0) latest = row;
  }
  return latest;
}
