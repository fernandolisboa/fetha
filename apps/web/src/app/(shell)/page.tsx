import type { Metadata } from "next";
import Link from "next/link";

import { formatDate } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";
import { formatPriceBRL } from "@/lib/format/brl";
import { requireUser } from "@/modules/auth";
import { AssetReadingChips, isMarketIndex } from "@/modules/market-data";
import { RadarPanel } from "@/modules/radar";
import { EmptyState, PageHeader, Panel, t as shellStrings } from "@/modules/shell";
import { hasMyActiveDailyStrategy } from "@/modules/strategies";
import {
  AddInstrumentCombobox,
  getMyWatchlist,
  RemoveFromWatchlistButton,
  t,
  WatchlistTabs,
} from "@/modules/watchlist";

export const metadata: Metadata = { title: `Fetha · ${shellStrings.destinations.watchlist}` };

export default async function WatchlistPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string }>;
}) {
  await requireUser();
  const { aba } = await searchParams;
  const tab = aba === "radar" ? "radar" : "watchlist";

  return (
    <div className="flex flex-1 flex-col gap-8 px-5 py-8">
      <PageHeader
        overline={t.page.overline}
        headline={t.page.title}
        actions={<AddInstrumentCombobox />}
      />
      <WatchlistTabs tab={tab} />
      {tab === "radar" ? <RadarPanel /> : <WatchlistTable />}
    </div>
  );
}

async function WatchlistTable() {
  const [items, hasActiveStrategy] = await Promise.all([
    getMyWatchlist(),
    hasMyActiveDailyStrategy(),
  ]);

  if (items.length === 0) {
    return <EmptyState sentence={shellStrings.emptyStates.watchlist.sentence} />;
  }

  return (
    <Panel>
      {!hasActiveStrategy && (
        <p className="text-muted-foreground text-[13px]" data-testid="no-active-strategy">
          {t.table.noStrategy}{" "}
          <Link href="/estrategias" className="text-primary underline-offset-4 hover:underline">
            {t.table.strategiesLink}
          </Link>
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-muted-foreground border-line-soft border-b text-[11px] uppercase">
              <th className="py-2 pr-4 font-normal whitespace-nowrap">{t.table.columns.ticker}</th>
              <th className="py-2 pr-4 font-normal whitespace-nowrap">{t.table.columns.reading}</th>
              <th className="py-2 pr-4 text-right font-normal whitespace-nowrap">
                {t.table.columns.lastClose}
              </th>
              <th className="py-2 pr-4 text-right font-normal whitespace-nowrap">
                {t.table.columns.session}
              </th>
              <th className="py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.ticker} className="border-line-soft border-b">
                <td className="py-2 pr-4 whitespace-nowrap">
                  <Link
                    href={`/ativos/${item.ticker}`}
                    className="font-mono uppercase underline-offset-4 hover:underline"
                  >
                    {item.ticker}
                  </Link>
                </td>
                <td className="py-2 pr-4">
                  {item.reading && <AssetReadingChips reading={item.reading} />}
                </td>
                <td className="py-2 pr-4 text-right font-mono whitespace-nowrap tabular-nums">
                  {item.lastClose
                    ? isMarketIndex(item.ticker)
                      ? formatDecimal(item.lastClose.close)
                      : formatPriceBRL(item.lastClose.close)
                    : t.table.noClose}
                </td>
                <td className="text-muted-foreground py-2 pr-4 text-right font-mono whitespace-nowrap tabular-nums">
                  {item.lastClose
                    ? formatDate(new Date(`${item.lastClose.session}T12:00:00Z`))
                    : "—"}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  <RemoveFromWatchlistButton ticker={item.ticker} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
