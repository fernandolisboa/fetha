import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { tickerSchema } from "@fetha/contracts";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { formatPriceBRL } from "@/lib/format/brl";
import { formatDate } from "@/lib/format/date-time";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";
import { requireUser } from "@/modules/auth";
import {
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

  const series = await optionSeriesDetail(
    getDb(),
    parsedTicker.data,
    todaySaoPauloDate(),
    RECENT_SESSIONS,
  );
  if (!series) {
    notFound();
  }

  const expiry = formatDate(sessionDateToDisplayDate(series.expiry));
  const lastTraded = series.prices.find((price) => price.close !== null);

  return (
    <div className="flex flex-col gap-8 px-5 py-8">
      {lastTraded?.close && (
        <InstrumentMarketBar
          instrument={{
            ticker: series.ticker,
            lastClose: formatPriceBRL(lastTraded.close),
            session: lastTraded.session,
          }}
        />
      )}

      <PageHeader
        overline={labels.overline}
        headline={series.ticker}
        headlineClassName="font-mono uppercase"
        actions={
          <Link
            href={`/ativos/${encodeURIComponent(series.underlying)}`}
            className={buttonVariants({ variant: "outline" })}
          >
            {labels.openUnderlying(series.underlying)}
          </Link>
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
            {labels.strike(formatPriceBRL(series.strike))}
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
