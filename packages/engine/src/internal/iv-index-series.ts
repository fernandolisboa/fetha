import type { Instant, Ticker } from "@fetha/contracts";
import type { ImpliedVolatilityIndexPoint, TruncationReport } from "../api";
import { isAfter } from "./instant";
import { codeUnitCompare, sortedEntries, sortUnique } from "./order";

export type BuildIvIndexSeriesInput = {
  points: readonly ImpliedVolatilityIndexPoint[];
  underlying: Ticker;
  at: Instant;
};

export type IvIndexSeriesResult =
  | { ok: true; value: { points: ImpliedVolatilityIndexPoint[]; truncated: TruncationReport[] } }
  | { ok: false; error: { path: string; message: string } };

export function buildIvIndexSeries(input: BuildIvIndexSeriesInput): IvIndexSeriesResult {
  const sorted = sortUnique(
    input.points,
    (p) => `${p.underlying}|${p.session}`,
    (a, b) => codeUnitCompare(a.underlying, b.underlying) || codeUnitCompare(a.session, b.session),
  );
  if (!sorted.ok) {
    return {
      ok: false,
      error: {
        path: "view.impliedVolatilityIndex",
        message: `duplicate implied-volatility index point for ${sorted.duplicateKey}`,
      },
    };
  }

  const truncated: TruncationReport[] = [];
  const otherUnderlyingDrops = new Map<string, number>();
  const points: ImpliedVolatilityIndexPoint[] = [];
  let afterAtDropped = 0;

  for (const p of sorted.value) {
    if (p.underlying !== input.underlying) {
      otherUnderlyingDrops.set(p.underlying, (otherUnderlyingDrops.get(p.underlying) ?? 0) + 1);
      continue;
    }
    if (isAfter(p.asOf, input.at)) {
      afterAtDropped += 1;
      continue;
    }
    points.push(p);
  }

  if (afterAtDropped > 0) {
    truncated.push({
      collection: "impliedVolatilityIndex",
      ticker: input.underlying,
      dropped: afterAtDropped,
      reason: "after_at",
    });
  }
  for (const [ticker, dropped] of sortedEntries(otherUnderlyingDrops)) {
    truncated.push({
      collection: "impliedVolatilityIndex",
      ticker,
      dropped,
      reason: "unreferenced_instrument",
    });
  }

  return { ok: true, value: { points, truncated } };
}
