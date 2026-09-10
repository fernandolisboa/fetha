import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { candleForms, type CandleForm } from "@fetha/engine";
import { tickerSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { formatPriceBRL } from "@/lib/format/brl";
import { requireUser } from "@/modules/auth";
import {
  CandleChart,
  CandleFormToggle,
  InstrumentMarketBar,
  latestCandle,
  loadCandleSeries,
  t,
} from "@/modules/market-data";
import { Panel } from "@/modules/shell";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>;
}): Promise<Metadata> {
  const { ticker } = await params;
  return { title: `Fetha · ${ticker.toUpperCase()}` };
}

function resolveForm(raw: string | undefined): CandleForm {
  return candleForms.includes(raw as CandleForm) ? (raw as CandleForm) : "adjusted";
}

export default async function InstrumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{ form?: string }>;
}) {
  await requireUser();
  const { ticker: rawTicker } = await params;
  const { form: rawForm } = await searchParams;
  const parsedTicker = tickerSchema.safeParse(rawTicker.toUpperCase());
  if (!parsedTicker.success) {
    notFound();
  }
  const ticker = parsedTicker.data;
  const form = resolveForm(rawForm);

  const db = getDb();
  const [lastClose, seriesResult] = await Promise.all([
    latestCandle(db, ticker),
    loadCandleSeries(db, ticker, form),
  ]);

  if (!seriesResult.ok) {
    console.error("loadCandleSeries failed", {
      code: seriesResult.error.code,
      path: "path" in seriesResult.error ? seriesResult.error.path : undefined,
      message: "message" in seriesResult.error ? seriesResult.error.message : undefined,
    });
  }

  return (
    <div className="flex flex-col gap-8 px-5 py-8">
      {lastClose && (
        <InstrumentMarketBar
          instrument={{
            ticker,
            lastClose: formatPriceBRL(lastClose.close),
            session: lastClose.session,
          }}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
            {t.instrument.overline}
          </p>
          <h1 className="font-mono text-[22px] font-semibold tracking-tight uppercase">{ticker}</h1>
        </div>
        <CandleFormToggle ticker={ticker} form={form} />
      </div>

      <Panel>
        {!seriesResult.ok ? (
          <p className="text-destructive text-sm">{t.instrument.unavailable}</p>
        ) : seriesResult.value.candles.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.instrument.noData}</p>
        ) : (
          <CandleChart candles={seriesResult.value.candles} />
        )}
      </Panel>
    </div>
  );
}
