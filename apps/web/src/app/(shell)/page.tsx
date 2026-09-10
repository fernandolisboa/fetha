import type { Metadata } from "next";
import Link from "next/link";

import { formatDate } from "@/lib/format/date-time";
import { formatPriceBRL } from "@/lib/format/brl";
import { requireUser } from "@/modules/auth";
import { EmptyState, Panel, t as shellStrings } from "@/modules/shell";
import {
  AddInstrumentCombobox,
  getMyWatchlist,
  RemoveFromWatchlistButton,
  t,
} from "@/modules/watchlist";

export const metadata: Metadata = { title: `Fetha · ${shellStrings.destinations.watchlist}` };

export default async function WatchlistPage() {
  await requireUser();
  const items = await getMyWatchlist();

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col gap-8 px-5 py-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
              {t.page.overline}
            </p>
            <h1 className="text-[22px] font-semibold tracking-tight">{t.page.title}</h1>
          </div>
          <AddInstrumentCombobox />
        </div>
        <EmptyState sentence={shellStrings.emptyStates.watchlist.sentence} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 px-5 py-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
            {t.page.overline}
          </p>
          <h1 className="text-[22px] font-semibold tracking-tight">{t.page.title}</h1>
        </div>
        <AddInstrumentCombobox />
      </div>

      <Panel>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-muted-foreground border-line-soft border-b text-[11px] uppercase">
              <th className="py-2 font-normal">{t.table.columns.ticker}</th>
              <th className="py-2 text-right font-normal">{t.table.columns.lastClose}</th>
              <th className="py-2 text-right font-normal">{t.table.columns.session}</th>
              <th className="py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.ticker} className="border-line-soft border-b">
                <td className="py-2">
                  <Link
                    href={`/ativos/${item.ticker}`}
                    className="font-mono uppercase underline-offset-4 hover:underline"
                  >
                    {item.ticker}
                  </Link>
                </td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {item.lastClose ? formatPriceBRL(item.lastClose.close) : t.table.noClose}
                </td>
                <td className="text-muted-foreground py-2 text-right font-mono tabular-nums">
                  {item.lastClose
                    ? formatDate(new Date(`${item.lastClose.session}T12:00:00Z`))
                    : "—"}
                </td>
                <td className="py-2 text-right">
                  <RemoveFromWatchlistButton ticker={item.ticker} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
