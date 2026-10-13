"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DecimalString, SessionDate } from "@fetha/contracts";

import { formatDate } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";
import {
  closeFreshnessKind,
  exchangeRateHref,
  sessionDateToDisplayDate,
} from "@/modules/market-data/client";

import { closeFreshnessPhrase } from "../close-freshness-phrase";
import { t } from "../strings";
import { useMarketBarInstrument } from "./market-bar-context";

const FRESHNESS_REFRESH_MS = 60_000;
const EXCHANGE_RATE_DECIMALS = 4;

export interface UsdBrlMarketBarQuote {
  rate: DecimalString;
  date: SessionDate;
}

// An installed PWA can sit open across midnight: recomputing `now` on an
// interval and on refocus keeps "fechamento de hoje" from freezing into a
// stale label instead of turning into "fechamento de ontem" (#13).
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

// The latest USDBRL PTAX (docs/adr/0059), loaded server-side in the shell
// layout and passed down as a prop: unlike the instrument slot below, it is
// not published by whatever page happens to be open, so it stays visible
// everywhere in the shell. The session date lives only in the link's title
// (narrow widths already truncate this bar, #305).
function UsdBrlChip({ usdBrl }: { usdBrl: UsdBrlMarketBarQuote }) {
  return (
    <Link
      href={exchangeRateHref("USDBRL")}
      title={t.marketBar.usdBrlAsOf(formatDate(sessionDateToDisplayDate(usdBrl.date)))}
      // Hidden below the width the header's own overflow budget was tested
      // at (360/390px, e2e/shell.spec.ts): the bar is already tight there
      // with just the focused instrument, so this fixture only grows the
      // bar from a width with room to spare.
      className="text-foreground hidden shrink-0 font-medium sm:inline"
    >
      USD/BRL {formatDecimal(usdBrl.rate, EXCHANGE_RATE_DECIMALS)}
    </Link>
  );
}

// IBOV/CDI land with a market index (out of this ticket's scope); the
// focused instrument's last close and freshness (#13) come from whatever
// page published one through MarketBarProvider.
export function MarketBar({ usdBrl }: { usdBrl: UsdBrlMarketBarQuote | null }) {
  const instrument = useMarketBarInstrument();
  const now = useNow(FRESHNESS_REFRESH_MS);

  if (!instrument) {
    return (
      <div className="text-muted-foreground ml-auto flex min-w-0 shrink items-center gap-2 overflow-hidden font-mono text-xs tabular-nums">
        {usdBrl && <UsdBrlChip usdBrl={usdBrl} />}
        <span className="min-w-0 truncate">{t.marketBar.noData}</span>
      </div>
    );
  }

  const freshness = closeFreshnessPhrase(closeFreshnessKind(instrument.session, now));

  return (
    <div className="text-muted-foreground ml-auto flex min-w-0 shrink items-center gap-2 overflow-hidden font-mono text-xs tabular-nums">
      {usdBrl && <UsdBrlChip usdBrl={usdBrl} />}
      <span className="text-foreground shrink-0 font-medium">{instrument.ticker}</span>
      <span className="shrink-0">{instrument.lastClose}</span>
      <span className="text-faint hidden min-w-0 truncate lg:inline">{freshness}</span>
    </div>
  );
}
