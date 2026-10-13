import type { ReactNode } from "react";
import type { SessionDate } from "@fetha/contracts";
import type { AssetReading } from "@fetha/engine";

import { Badge } from "@/components/ui/badge";
import { formatPriceBRL } from "@/lib/format/brl";
import { formatDate } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";
import { formatPercent } from "@/lib/format/percent";
import { cn } from "@/lib/utils";

import { sessionDateToDisplayDate } from "../close-freshness";
import { t } from "../strings";

const strings = t.reading;

function displaySession(session: SessionDate): string {
  return formatDate(sessionDateToDisplayDate(session));
}

const trendTone = { up: "text-up", down: "text-down", sideways: "text-muted-foreground" } as const;

function Chip({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("font-mono text-[11px] font-normal", className)}
      title={title}
    >
      {children}
    </Badge>
  );
}

export function AssetReadingChips({ reading }: { reading: AssetReading }) {
  const trend = reading.trend.label;
  const iv = reading.impliedVolatility.label;
  const liquid = reading.options.label === "liquid";
  if (!trend && !iv && !liquid) {
    return null;
  }
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={strings.chipsLabel}>
      {trend && (
        <li>
          <Chip className={trendTone[trend]} title={strings.trend.label[trend]}>
            {strings.trend.chip[trend]}
          </Chip>
        </li>
      )}
      {iv && (
        <li>
          <Chip title={strings.impliedVolatility.label[iv]}>
            {strings.impliedVolatility.chip[iv]}
          </Chip>
        </li>
      )}
      {liquid && (
        <li>
          <Chip className="text-primary" title={strings.options.chipTitle}>
            {strings.options.chip}
          </Chip>
        </li>
      )}
    </ul>
  );
}

function ReadingRow({
  name,
  label,
  labelClassName,
  detail,
  sentence,
  children,
}: {
  name: string;
  label: string | null;
  labelClassName?: string;
  detail?: string | null;
  sentence: string;
  children?: ReactNode;
}) {
  return (
    <div className="border-line-soft grid gap-1 border-t py-3 first:border-t-0 first:pt-0 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
      <dt className="flex flex-col gap-1">
        <span className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
          {name}
        </span>
        {label && <span className={cn("text-[13px] font-medium", labelClassName)}>{label}</span>}
      </dt>
      <dd className="flex min-w-0 flex-col gap-1 text-[13px]">
        <p>{sentence}</p>
        {detail && <p className="text-muted-foreground font-mono text-xs tabular-nums">{detail}</p>}
        {children}
      </dd>
    </div>
  );
}

function trendRow(reading: AssetReading, isIndex: boolean) {
  const { label, smaShort, smaLong } = reading.trend;
  const formatLevel = isIndex ? formatDecimal : formatPriceBRL;
  return (
    <ReadingRow
      name={strings.trend.name}
      label={label ? strings.trend.label[label] : null}
      labelClassName={label ? trendTone[label] : undefined}
      sentence={label ? strings.trend.sentence[label] : strings.trend.missing}
      detail={
        smaShort && smaLong
          ? strings.trend.detail(formatLevel(smaShort), formatLevel(smaLong))
          : null
      }
    />
  );
}

function momentumRow(reading: AssetReading) {
  const { label, rsi } = reading.momentum;
  return (
    <ReadingRow
      name={strings.momentum.name}
      label={label ? strings.momentum.label[label] : null}
      sentence={
        label && rsi
          ? strings.momentum.sentence[label](formatDecimal(rsi, 1))
          : strings.momentum.missing
      }
    />
  );
}

function rangeRow(reading: AssetReading) {
  const { label, atr, atrShare } = reading.range;
  return (
    <ReadingRow
      name={strings.range.name}
      label={label ? strings.range.label[label] : null}
      sentence={
        label && atr && atrShare
          ? strings.range.sentence[label](formatPriceBRL(atr), formatPercent(atrShare))
          : strings.range.missing
      }
    />
  );
}

function impliedVolatilityRow(reading: AssetReading) {
  const { label, ivRank, latest } = reading.impliedVolatility;
  const iv = latest ? formatPercent(latest.impliedVolatility) : null;
  const sentence =
    label && ivRank && iv
      ? strings.impliedVolatility.sentence[label](iv, formatDecimal(ivRank, 0))
      : iv
        ? strings.impliedVolatility.noRank(iv)
        : strings.impliedVolatility.missing;
  return (
    <ReadingRow
      name={strings.impliedVolatility.name}
      label={label ? strings.impliedVolatility.label[label] : null}
      sentence={sentence}
    />
  );
}

function optionsRow(reading: AssetReading) {
  const { label, session, tradedSeries, nextExpiries } = reading.options;
  const sentence =
    nextExpiries.length === 0 || !session
      ? strings.options.notListed
      : label === "none"
        ? strings.options.sentence.none(displaySession(session))
        : strings.options.sentence[label](tradedSeries, displaySession(session));
  return (
    <ReadingRow
      name={strings.options.name}
      label={nextExpiries.length === 0 ? null : strings.options.label[label]}
      labelClassName={label === "liquid" ? "text-primary" : undefined}
      sentence={sentence}
    >
      {nextExpiries.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
            {strings.options.expiriesTitle}
          </p>
          <ul className="font-mono text-xs tabular-nums">
            {nextExpiries.map((expiry) => (
              <li key={expiry.expiry}>
                {strings.options.expiry(
                  displaySession(expiry.expiry),
                  expiry.series,
                  expiry.tradedSeries,
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </ReadingRow>
  );
}

export function AssetReadingPanel({
  reading,
  isIndex = false,
}: {
  reading: AssetReading | null;
  isIndex?: boolean;
}) {
  if (!reading) {
    return <p className="text-muted-foreground text-[13px]">{strings.unavailable}</p>;
  }
  if (!reading.session) {
    return <p className="text-muted-foreground text-[13px]">{strings.noSession}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">
        {strings.subtitle(displaySession(reading.session))}
      </p>
      <dl className="flex flex-col">
        {trendRow(reading, isIndex)}
        {momentumRow(reading)}
        {/* The range row is ATR, computed from the synthetic open=high=low=close
            candle a market index is ingested with (ADR-0062): "daily range" has
            no meaning there, so it is never shown. */}
        {!isIndex && rangeRow(reading)}
        {impliedVolatilityRow(reading)}
        {optionsRow(reading)}
      </dl>
    </div>
  );
}
