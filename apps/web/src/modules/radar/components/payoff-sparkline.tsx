import type { PayoffPoint } from "@fetha/engine";

import {
  buildPayoffSparkline,
  PAYOFF_SPARK_VIEW_HEIGHT,
  PAYOFF_SPARK_VIEW_WIDTH,
} from "../payoff-sparkline";

// The compact row's spark (ticket: card B, docs/adr/0067 amendment): a decorative preview, never
// the only way to read a number — the row's own text already says what it risks and gains, so
// this is `aria-hidden` with no accessible name of its own.
export function PayoffSparkline({ payoff }: { payoff: readonly PayoffPoint[] }) {
  const spark = buildPayoffSparkline(payoff);
  if (!spark) return null;

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${String(PAYOFF_SPARK_VIEW_WIDTH)} ${String(PAYOFF_SPARK_VIEW_HEIGHT)}`}
      preserveAspectRatio="none"
      className="h-[34px] w-full"
    >
      <path d={spark.upAreaPath} fill="var(--up)" fillOpacity={0.15} />
      <path d={spark.downAreaPath} fill="var(--down)" fillOpacity={0.15} />
      <line
        x1={0}
        x2={PAYOFF_SPARK_VIEW_WIDTH}
        y1={spark.zeroY}
        y2={spark.zeroY}
        stroke="var(--line)"
        strokeWidth={1}
      />
      <path d={spark.linePath} fill="none" stroke="var(--chart-stroke)" strokeWidth={1.5} />
    </svg>
  );
}
