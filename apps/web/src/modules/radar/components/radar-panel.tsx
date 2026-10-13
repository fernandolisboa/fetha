import Link from "next/link";
import type { DecimalString, IndicatorSpec } from "@fetha/contracts";

import { formatPriceBRL } from "@/lib/format/brl";
import { formatDate } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";
import { AssetReadingChips, sessionDateToDisplayDate } from "@/modules/market-data";
import { Panel } from "@/modules/shell";
import { AddToWatchlistButton } from "@/modules/watchlist";

import type { RadarFacts, RadarLeg } from "../match";
import { getRadar } from "../queries";
import type { RadarRowMatch } from "../radar-view";
import { t } from "../strings";

function displayDate(session: string): string {
  return formatDate(sessionDateToDisplayDate(session));
}

function indicatorName(spec: IndicatorSpec): string {
  return spec.kind === "iv_rank"
    ? t.facts.iv_rank(spec.lookbackSessions)
    : t.facts[spec.kind](spec.length);
}

function indicatorValue(spec: IndicatorSpec, value: DecimalString | null): string {
  if (value === null) return t.facts.missing;
  switch (spec.kind) {
    case "sma":
    case "ema":
    case "atr":
      return formatPriceBRL(value);
    case "rsi":
      return formatDecimal(value, 1);
    case "iv_rank":
      return formatDecimal(value, 0);
  }
}

function Facts({ facts }: { facts: RadarFacts }) {
  const entries = [
    { name: t.facts.close, value: formatPriceBRL(facts.close) },
    ...facts.indicators.map(({ indicator, value }) => ({
      name: indicatorName(indicator),
      value: indicatorValue(indicator, value),
    })),
  ];
  return (
    <dl aria-label={t.table.factsLabel} className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {entries.map((entry) => (
        <div key={entry.name} className="flex gap-1.5">
          <dt className="text-muted-foreground">{entry.name}</dt>
          <dd className="font-mono tabular-nums">{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function legText(leg: RadarLeg): string {
  const parts = [`${t.legs.side[leg.side]} ${t.legs.role[leg.role]} ${leg.ticker}`];
  if (leg.strike) parts.push(t.legs.strike(formatDecimal(leg.strike)));
  if (leg.expiry) parts.push(t.legs.expiry(displayDate(leg.expiry)));
  return parts.join(" · ");
}

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
        <p className="text-muted-foreground text-[13px]">{t.panel.none(date)}</p>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">{t.panel.order}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
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
