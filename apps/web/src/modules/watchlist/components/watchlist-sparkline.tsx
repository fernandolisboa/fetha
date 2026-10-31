import { formatPercent } from "@/lib/format/percent";

import { t } from "../strings";
import { SPARKLINE_HEIGHT, SPARKLINE_WIDTH, type Sparkline } from "../sparkline";

export function WatchlistSparkline({ sparkline }: { sparkline: Sparkline | null }) {
  if (!sparkline) {
    return (
      <span className="text-muted-foreground font-mono" data-testid="watchlist-sparkline-empty">
        —
      </span>
    );
  }

  const color = sparkline.direction === "up" ? "var(--up)" : "var(--down)";

  return (
    <div
      className="flex items-center justify-end gap-2 @max-[36rem]/table:justify-start"
      data-testid="watchlist-sparkline"
    >
      <svg
        role="img"
        aria-label={t.table.sparklineLabel}
        width={SPARKLINE_WIDTH}
        height={SPARKLINE_HEIGHT}
        viewBox={`0 0 ${String(SPARKLINE_WIDTH)} ${String(SPARKLINE_HEIGHT)}`}
        className="shrink-0"
      >
        <polyline
          points={sparkline.points}
          fill="none"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ stroke: color }}
        />
      </svg>
      <span className="font-mono whitespace-nowrap tabular-nums" style={{ color }}>
        {formatPercent(sparkline.changeFraction)}
      </span>
    </div>
  );
}
