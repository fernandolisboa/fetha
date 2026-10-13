"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DecimalString, SessionDate } from "@fetha/contracts";

import { formatExchangeRateBRL } from "@/lib/format/brl";
import { formatDecimal } from "@/lib/format/decimal";
import { formatDate } from "@/lib/format/date-time";
import {
  closeFreshnessKind,
  exchangeRateHref,
  sessionDateToDisplayDate,
} from "@/modules/market-data/client";

import { closeFreshnessPhrase } from "../close-freshness-phrase";
import { t } from "../strings";
import { useMarketBarInstrument } from "./market-bar-context";

const FRESHNESS_REFRESH_MS = 60_000;

export interface UsdBrlMarketBarQuote {
  rate: DecimalString;
  date: SessionDate;
}

export interface IbovMarketBarQuote {
  close: DecimalString;
  session: SessionDate;
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

// The latest USDBRL PTAX (docs/adr/0061), loaded server-side in the shell
// layout and passed down as a prop: unlike the instrument slot below, it is
// not published by whatever page happens to be open, so it stays visible
// everywhere in the shell.
function UsdBrlChip({ usdBrl }: { usdBrl: UsdBrlMarketBarQuote }) {
  const dateLabel = formatDate(sessionDateToDisplayDate(usdBrl.date));
  return (
    <>
      <Link
        href={exchangeRateHref("USDBRL")}
        title={t.marketBar.usdBrlAsOf(dateLabel)}
        // Hidden below the width the header's own overflow budget was tested
        // at (360/390px, e2e/shell.spec.ts): the bar is already tight there
        // with just the focused instrument, so this fixture only grows the
        // bar from a width with room to spare.
        className="text-foreground hidden shrink-0 font-medium sm:inline"
      >
        USD/BRL {formatExchangeRateBRL(usdBrl.rate)}
      </Link>
      {/* Same breakpoint the focused instrument's own freshness uses below:
          the PTAX date as visible muted text, not only in the link's title. */}
      <span className="text-faint hidden shrink-0 lg:inline">{dateLabel}</span>
    </>
  );
}

// The Ibovespa's own daily close (ADR-0062), loaded server-side in the shell layout and passed
// down as a prop, same shape as UsdBrlChip above: not published by whatever page happens to be
// open, so it stays visible everywhere in the shell. Points, never `R$` (ADR-0062).
function IbovChip({ ibov }: { ibov: IbovMarketBarQuote }) {
  const dateLabel = formatDate(sessionDateToDisplayDate(ibov.session));
  return (
    <>
      <Link
        href="/ativos/IBOV11"
        title={t.marketBar.ibovAsOf(dateLabel)}
        // Same breakpoint budget as UsdBrlChip below (e2e/shell.spec.ts, 360/390px).
        className="text-foreground hidden shrink-0 font-medium sm:inline"
      >
        IBOV {formatDecimal(ibov.close)}
      </Link>
      <span className="text-faint hidden shrink-0 lg:inline">{dateLabel}</span>
    </>
  );
}

// CDI lands later (out of this ticket's scope); the focused instrument's last close and
// freshness (#13) come from whatever page published one through MarketBarProvider.
export function MarketBar({
  usdBrl,
  ibov,
}: {
  usdBrl: UsdBrlMarketBarQuote | null;
  ibov: IbovMarketBarQuote | null;
}) {
  const instrument = useMarketBarInstrument();
  const now = useNow(FRESHNESS_REFRESH_MS);

  if (!instrument) {
    return (
      <div
        data-testid="market-bar"
        className="text-muted-foreground ml-auto flex min-w-0 shrink items-center gap-2 overflow-hidden font-mono text-xs tabular-nums"
      >
        {ibov && <IbovChip ibov={ibov} />}
        {usdBrl && <UsdBrlChip usdBrl={usdBrl} />}
        {!ibov && !usdBrl && <span className="min-w-0 truncate">{t.marketBar.noData}</span>}
      </div>
    );
  }

  const freshness = closeFreshnessPhrase(closeFreshnessKind(instrument.session, now));

  return (
    <div
      data-testid="market-bar"
      className="text-muted-foreground ml-auto flex min-w-0 shrink items-center gap-2 overflow-hidden font-mono text-xs tabular-nums"
    >
      {ibov && <IbovChip ibov={ibov} />}
      {usdBrl && <UsdBrlChip usdBrl={usdBrl} />}
      <span className="text-foreground shrink-0 font-medium">{instrument.ticker}</span>
      <span className="shrink-0">{instrument.lastClose}</span>
      <span className="text-faint hidden min-w-0 truncate lg:inline">{freshness}</span>
    </div>
  );
}
