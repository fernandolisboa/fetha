import { t } from "../strings";

// Real IBOV/CDI/instrument data lands with market data ingestion (#13); until
// then the bar states plainly that there is nothing to show yet, per
// DESIGN.md's stale/empty states.
export function MarketBar() {
  return (
    <div className="text-muted-foreground ml-auto font-mono text-xs tabular-nums">
      {t.marketBar.noData}
    </div>
  );
}
