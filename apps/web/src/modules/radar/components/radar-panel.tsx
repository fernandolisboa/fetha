import Link from "next/link";

import { AssetReadingChips } from "@/modules/market-data";
import { Panel } from "@/modules/shell";
import { AddToWatchlistButton } from "@/modules/watchlist";

import { getRadar } from "../queries";
import type { RadarRowMatch } from "../radar-view";
import { t } from "../strings";
import { displayDate, Facts, legText } from "./radar-facts";

function Match({ match }: { match: RadarRowMatch }) {
  return (
    <li className="flex flex-col gap-1.5">
      <p className="text-[13px] font-medium">{t.table.found(match.recipeName)}</p>
      <Facts facts={match.facts} />
      <ul aria-label={t.table.legsLabel} className="text-muted-foreground font-mono text-xs">
        {match.legs.map((leg) => (
          <li key={`${leg.side}-${leg.ticker}`}>{legText(leg)}</li>
        ))}
      </ul>
    </li>
  );
}

export async function RadarPanel() {
  const radar = await getRadar();
  if (!radar) {
    return (
      <Panel>
        <p className="text-muted-foreground text-[13px]">{t.panel.notRun}</p>
      </Panel>
    );
  }
  const date = displayDate(radar.session);

  return (
    <Panel>
      <div className="flex flex-col gap-1 text-[13px]">
        <p>{t.panel.intro}</p>
        <p
          className="text-muted-foreground font-mono text-xs tabular-nums"
          data-testid="radar-session"
        >
          {t.panel.session(date, radar.scanned, radar.universe)}
        </p>
        {radar.pending.length > 0 && (
          <p className="text-muted-foreground text-xs">{t.panel.pending(radar.pending.length)}</p>
        )}
      </div>
      {radar.rows.length === 0 ? (
        radar.pending.length === 0 && (
          <p className="text-muted-foreground text-[13px]">{t.panel.none(date)}</p>
        )
      ) : (
        <>
          <p className="text-muted-foreground text-xs">{t.panel.order}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm [&_td:not(:first-child)]:pl-3 [&_th:not(:first-child)]:pl-3">
              <thead>
                <tr className="text-muted-foreground border-line-soft border-b text-[11px] uppercase">
                  <th className="py-2 pr-4 font-normal whitespace-nowrap">
                    {t.table.columns.ticker}
                  </th>
                  <th className="py-2 pr-4 font-normal">{t.table.columns.recipes}</th>
                  <th className="py-2 pr-4 text-right font-normal whitespace-nowrap">
                    {t.table.columns.options}
                  </th>
                  <th className="py-2 font-normal" />
                </tr>
              </thead>
              <tbody>
                {radar.rows.map((row) => (
                  <tr key={row.ticker} className="border-line-soft border-b align-top">
                    <td className="py-3 pr-4">
                      <div className="flex flex-col gap-1.5">
                        <Link
                          href={`/ativos/${row.ticker}`}
                          className="font-mono uppercase underline-offset-4 hover:underline"
                        >
                          {row.ticker}
                        </Link>
                        <AssetReadingChips reading={row.reading} />
                      </div>
                    </td>
                    <td className="min-w-[280px] py-3 pr-4">
                      <ul className="flex flex-col gap-3">
                        {row.matches.map((match) => (
                          <Match key={match.recipeId} match={match} />
                        ))}
                      </ul>
                    </td>
                    <td className="text-muted-foreground py-3 pr-4 text-right font-mono text-xs whitespace-nowrap tabular-nums">
                      {t.table.tradedSeries(row.reading.options.tradedSeries)}
                    </td>
                    <td className="py-3">
                      <div className="flex flex-col items-end gap-2 whitespace-nowrap">
                        {row.onWatchlist ? (
                          <span className="text-muted-foreground text-xs">
                            {t.table.onWatchlist}
                          </span>
                        ) : (
                          <AddToWatchlistButton ticker={row.ticker} />
                        )}
                        <Link
                          href={`/ativos/${row.ticker}#receitas`}
                          className="text-primary text-xs underline-offset-4 hover:underline"
                        >
                          {t.table.seeRecipes}
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}
