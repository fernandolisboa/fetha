import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { getDb } from "@/db/client";
import { formatExchangeRateBRL } from "@/lib/format/brl";
import { formatDate } from "@/lib/format/date-time";
import { requireUser } from "@/modules/auth";
import {
  exchangeRatePairSchema,
  exchangeRateSeries,
  latestExchangeRate,
  RateLineChart,
  sessionDateToDisplayDate,
  t,
} from "@/modules/market-data";
import { InstrumentMarketBar, PageHeader, Panel } from "@/modules/shell";

const labels = t.exchangeRate;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ pair: string }>;
}): Promise<Metadata> {
  const { pair } = await params;
  return { title: `Fetha · ${pair.toUpperCase()}` };
}

export default async function ExchangeRatePage({ params }: { params: Promise<{ pair: string }> }) {
  await requireUser();
  const { pair: rawPair } = await params;
  const parsed = exchangeRatePairSchema.safeParse(rawPair.toUpperCase());
  if (!parsed.success) {
    notFound();
  }
  const pair = parsed.data;

  const db = getDb();
  const [latest, points] = await Promise.all([
    latestExchangeRate(db, pair),
    exchangeRateSeries(db, pair),
  ]);

  return (
    <div className="flex flex-col gap-8 px-5 py-8">
      {latest && (
        <InstrumentMarketBar
          instrument={{
            ticker: pair,
            lastClose: formatExchangeRateBRL(latest.rate),
            session: latest.date,
          }}
        />
      )}

      <PageHeader
        overline={labels.overline}
        headline={`${pair.slice(0, 3)}/${pair.slice(3)}`}
        headlineClassName="font-mono uppercase"
      />

      <ul className="flex flex-wrap gap-2">
        <li>
          <Badge variant="secondary">{labels.pairLabel[pair]}</Badge>
        </li>
        <li>
          <Badge variant="secondary">{labels.chipPtax}</Badge>
        </li>
        <li>
          <Badge variant="outline">{labels.chipSource}</Badge>
        </li>
      </ul>

      <Panel>
        {latest ? (
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-xs">
              {labels.lastRate(formatDate(sessionDateToDisplayDate(latest.date)))}
            </p>
            <p className="font-mono text-[22px] font-semibold tabular-nums">
              {formatExchangeRateBRL(latest.rate)}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{labels.noData}</p>
        )}
        <p className="text-faint text-xs">{labels.note}</p>
      </Panel>

      <Panel>
        {points.length === 0 ? (
          <p className="text-muted-foreground text-sm">{labels.noData}</p>
        ) : (
          <RateLineChart points={points} />
        )}
      </Panel>
    </div>
  );
}
