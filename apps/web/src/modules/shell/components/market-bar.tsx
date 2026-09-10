"use client";

import { useEffect, useState } from "react";

import { closeFreshnessKind } from "@/modules/market-data/client";

import { closeFreshnessPhrase } from "../close-freshness-phrase";
import { t } from "../strings";
import { useMarketBarInstrument } from "./market-bar-context";

const FRESHNESS_REFRESH_MS = 60_000;

// An installed PWA can sit open across midnight: recomputing `now` on an
// interval and on refocus keeps "fechamento de hoje" from freezing into a
// stale label instead of turning into "fechamento de ontem" (#13 round 1).
function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    function refresh() {
      setNow(new Date());
    }
    const interval = setInterval(refresh, intervalMs);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [intervalMs]);

  return now;
}

// IBOV/CDI land with a market index (out of this ticket's scope); the
// focused instrument's last close and freshness (#13) come from whatever
// page published one through MarketBarProvider.
export function MarketBar() {
  const instrument = useMarketBarInstrument();
  const now = useNow(FRESHNESS_REFRESH_MS);

  if (!instrument) {
    return (
      <div className="text-muted-foreground ml-auto font-mono text-xs tabular-nums">
        {t.marketBar.noData}
      </div>
    );
  }

  const freshness = closeFreshnessPhrase(closeFreshnessKind(instrument.session, now));

  return (
    <div className="text-muted-foreground ml-auto flex items-center gap-2 font-mono text-xs tabular-nums">
      <span className="text-foreground font-medium">{instrument.ticker}</span>
      <span>{instrument.lastClose}</span>
      <span className="text-faint">{freshness}</span>
    </div>
  );
}
