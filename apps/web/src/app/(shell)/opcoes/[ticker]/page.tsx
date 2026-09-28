import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { tickerSchema } from "@fetha/contracts";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { formatPriceBRL } from "@/lib/format/brl";
import { formatDate } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";
import { requireUser } from "@/modules/auth";
import {
  latestCandle,
  OptionSeriesPricesTable,
  optionSeriesDetail,
  sessionDateToDisplayDate,
  t,
} from "@/modules/market-data";
import { InstrumentMarketBar, PageHeader, Panel } from "@/modules/shell";

const RECENT_SESSIONS = 20;

const labels = t.optionSeries;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>;
}): Promise<Metadata> {
  const { ticker } = await params;
  return { title: `Fetha · ${ticker.toUpperCase()}` };
}

export default async function OptionSeriesPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  await requireUser();
  const { ticker: rawTicker } = await params;
  const parsedTicker = tickerSchema.safeParse(rawTicker.toUpperCase());
  if (!parsedTicker.success) {
    notFound();
  }

  const db = getDb();
  const series = await optionSeriesDetail(
    db,
    parsedTicker.data,
    todaySaoPauloDate(),
    RECENT_SESSIONS,
  );
  if (!series) {
    notFound();
  }
  // An index option's underlying (IBOV) has no candle of its own, so there
  // is no instrument page worth linking to.
  const underlyingCandle = await latestCandle(db, series.underlying);

  const expiry = formatDate(sessionDateToDisplayDate(series.expiry));

  return (
    <div className="flex flex-col gap-8 px-5 py-8">
      {series.lastTrade && (
        <InstrumentMarketBar
          instrument={{
            ticker: series.ticker,
            lastClose: formatPriceBRL(series.lastTrade.close),
            session: series.lastTrade.session,
          }}
        />
      )}

      <PageHeader
        overline={labels.overline}
        headline={series.ticker}
        headlineClassName="font-mono uppercase"
        actions={
          underlyingCandle && (
            <Link
              href={`/ativos/${encodeURIComponent(series.underlying)}`}
              className={buttonVariants({ variant: "outline" })}
            >
              {labels.openUnderlying(series.underlying)}
            </Link>
          )
        }
      />

      <ul className="flex flex-wrap gap-2">
        <li>
          <Badge variant="secondary">{labels.right[series.right]}</Badge>
        </li>
        <li>
          <Badge variant="secondary">{labels.style[series.style]}</Badge>
        </li>
        <li>
          <Badge variant="secondary" className="font-mono tabular-nums">
            {labels.strike(formatDecimal(series.strike))}
          </Badge>
        </li>
        <li>
          <Badge
            variant={series.expired ? "outline" : "secondary"}
            className="font-mono tabular-nums"
          >
            {series.expired ? labels.expired(expiry) : labels.expires(expiry)}
          </Badge>
        </li>
      </ul>

      <Panel title={labels.prices.title} subtitle={labels.prices.subtitle}>
        <OptionSeriesPricesTable prices={series.prices} />
      </Panel>
    </div>
  );
}
