"use client";

import { useMarketBarInstrument } from "./market-bar-context";
import { t } from "../strings";

// IBOV/CDI land with a market index (out of this ticket's scope); the
// focused instrument's last close and freshness (#13) come from whatever
// page published one through MarketBarProvider.
export function MarketBar() {
  const instrument = useMarketBarInstrument();

  if (!instrument) {
    return (
      <div className="text-muted-foreground ml-auto font-mono text-xs tabular-nums">
        {t.marketBar.noData}
      </div>
    );
  }

  return (
    <div className="text-muted-foreground ml-auto flex items-center gap-2 font-mono text-xs tabular-nums">
      <span className="text-foreground font-medium">{instrument.ticker}</span>
      <span>{instrument.lastClose}</span>
      <span className="text-faint">{instrument.freshness}</span>
    </div>
  );
}
