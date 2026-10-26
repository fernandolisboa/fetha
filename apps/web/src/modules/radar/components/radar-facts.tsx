import type { DecimalString, IndicatorSpec } from "@fetha/contracts";

import { formatPriceBRL } from "@/lib/format/brl";
import { formatDate } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";
import { sessionDateToDisplayDate } from "@/modules/market-data/client";

import type { RadarFacts, RadarLeg } from "../match";
import { t } from "../strings";

export function displayDate(session: string): string {
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

export function Facts({ facts }: { facts: RadarFacts }) {
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

export function legText(leg: RadarLeg): string {
  const parts = [`${t.legs.side[leg.side]} ${t.legs.role[leg.role]} ${leg.ticker}`];
  if (leg.strike) parts.push(t.legs.strike(formatDecimal(leg.strike)));
  if (leg.expiry) parts.push(t.legs.expiry(displayDate(leg.expiry)));
  return parts.join(" · ");
}
