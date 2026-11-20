"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { ChevronDownIcon } from "lucide-react";
import { decimalStringSchema } from "@fetha/contracts";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandStatus,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { formatPriceBRL } from "@/lib/format/brl";
import { formatSessionDate } from "@/lib/format/date-time";
import { formatDecimal } from "@/lib/format/decimal";
import { parsePtBrDecimal } from "@/lib/format/parse-decimal";
import { formatPercent } from "@/lib/format/percent";

import { t } from "../strings";
import {
  defaultExpiry,
  expiryOptions,
  pickerRows,
  type SeriesFilters,
  type SeriesRow,
} from "./series-picker-model";
import type { ChainSeries } from "./types";

const strings = t.builder.seriesPicker;

// One grid for the header and every row: three columns on a phone (the
// rest folds into a second line), seven once the popup is wide enough.
const ROW_GRID =
  "grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 @[40rem]/picker:grid-cols-[6.5rem_4.5rem_4.5rem_minmax(0,1fr)_6.5rem_6.5rem_4.5rem]";
const WIDE_ONLY = "hidden @[40rem]/picker:block";
const CHIP = "aria-pressed:border-(--accent) aria-pressed:text-(--accent)";

// The strike inputs live inside cmdk's root, whose keydown handler would
// otherwise turn Enter into "pick the highlighted series" and arrows into
// list navigation while the user is typing a bound.
function keepKeysInField(event: KeyboardEvent<HTMLInputElement>) {
  if (["Enter", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
    event.stopPropagation();
  }
}

function signedPercent(distance: string): string {
  const formatted = formatPercent(decimalStringSchema.parse(distance));
  return formatted.startsWith("−") || formatted === "0%" ? formatted : `+${formatted}`;
}

// Rows arrive sorted by expiry; with every cycle shown, each one gets a
// heading so a strike is never read against the wrong expiry.
function groupByExpiry(rows: SeriesRow[]): { expiry: string; rows: SeriesRow[] }[] {
  const groups: { expiry: string; rows: SeriesRow[] }[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last?.expiry === row.series.expiry) last.rows.push(row);
    else groups.push({ expiry: row.series.expiry, rows: [row] });
  }
  return groups;
}

function StrikeBound({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const invalid = value.trim() !== "" && parsePtBrDecimal(value, 8) === null;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-muted-foreground text-[11px]">
        {label}
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        className="h-7 w-24 font-mono tabular-nums"
        value={value}
        aria-invalid={invalid}
        title={invalid ? strings.invalidStrike : undefined}
        onKeyDown={keepKeysInField}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

function SeriesRowContent({ row }: { row: SeriesRow }) {
  const { series, distance, moneyness } = row;
  const strike = formatDecimal(decimalStringSchema.parse(series.strike));
  const price = series.lastPrice
    ? formatDecimal(decimalStringSchema.parse(series.lastPrice.value))
    : null;
  const session = series.lastPrice ? formatSessionDate(series.lastPrice.session) : null;
  const tradedAtStrike = series.lastPriceStrike
    ? t.builder.legsTable.tradedAtStrike(
        formatDecimal(decimalStringSchema.parse(series.lastPriceStrike)),
      )
    : null;
  const distanceText = distance === null ? "—" : signedPercent(distance);
  const moneynessText = moneyness === null ? "—" : strings.moneyness[moneyness];
  const secondLine = [
    distance === null ? null : distanceText,
    moneyness === null ? null : moneynessText,
    session,
    series.lastPrice ? strings.trades(series.lastPrice.trades) : null,
    tradedAtStrike,
  ].filter((part) => part !== null);

  return (
    <div className={`${ROW_GRID} text-[12px]`}>
      <span className="font-mono">{series.ticker}</span>
      <span className="text-right font-mono tabular-nums">{strike}</span>
      <span className={`${WIDE_ONLY} text-right font-mono tabular-nums`}>{distanceText}</span>
      <span className={`${WIDE_ONLY} text-muted-foreground truncate`}>{moneynessText}</span>
      <span className="text-right font-mono tabular-nums">
        {price ?? (
          <span className="font-sans" style={{ color: "var(--faint)" }}>
            {t.builder.legsTable.noTrades}
          </span>
        )}
      </span>
      <span className={`${WIDE_ONLY} text-muted-foreground font-mono tabular-nums`}>
        {session ?? "—"}
        {tradedAtStrike ? (
          <span className="block font-sans text-[10px]" style={{ color: "var(--warning)" }}>
            {tradedAtStrike}
          </span>
        ) : null}
      </span>
      <span className={`${WIDE_ONLY} text-muted-foreground text-right font-mono tabular-nums`}>
        {series.lastPrice ? String(series.lastPrice.trades) : "—"}
      </span>
      {secondLine.length > 0 ? (
        <span className="text-muted-foreground col-span-3 text-[11px] @[40rem]/picker:hidden">
          {secondLine.join(" · ")}
        </span>
      ) : null}
    </div>
  );
}

export function SeriesPicker({
  label,
  underlying,
  options,
  lockedExpiry,
  spot,
  value,
  onChange,
}: {
  label: string;
  underlying: string;
  options: ChainSeries[];
  lockedExpiry: string | null;
  spot: { value: string; session: string } | null;
  value: string | null;
  onChange: (ticker: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState<SeriesFilters>({
    query: "",
    expiry: null,
    minStrike: "",
    maxStrike: "",
    includeUntraded: false,
  });

  const selected = options.find((series) => series.ticker === value) ?? null;
  const expiries = expiryOptions(options);
  const expiry = lockedExpiry ?? filters.expiry;
  const effective = { ...filters, expiry };
  const rows = pickerRows(options, effective, spot?.value ?? null);
  const inCycle = options.filter((series) => expiry === null || series.expiry === expiry);
  const untradedInCycle = inCycle.filter((series) => series.lastPrice === null).length;

  function update(patch: Partial<SeriesFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  function openPicker(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      setFilters({
        query: "",
        expiry: selected?.expiry ?? defaultExpiry(options),
        minStrike: "",
        maxStrike: "",
        includeUntraded: selected !== null && selected.lastPrice === null,
      });
    }
  }

  return (
    <Popover open={open} onOpenChange={openPicker}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            aria-label={label}
            className="w-full min-w-36 justify-between font-mono font-normal uppercase"
          >
            {selected ? (
              <span>{selected.ticker}</span>
            ) : (
              <span className="text-muted-foreground font-sans normal-case">
                {t.builder.legsTable.pickInstrument}
              </span>
            )}
            <ChevronDownIcon className="text-muted-foreground" aria-hidden />
          </Button>
        }
      />
      <PopoverContent
        align="start"
        collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
        collisionPadding={16}
        className="@container/picker max-h-[min(var(--available-height),40rem)] w-[min(48rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
      >
        <Command
          label={strings.searchLabel}
          shouldFilter={false}
          className="min-h-0 flex-1 rounded-none! p-0"
        >
          <div className="border-b p-2">
            <CommandInput
              placeholder={strings.search}
              value={filters.query}
              onValueChange={(query) => {
                update({ query });
              }}
            />
            <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2 px-1">
              <StrikeBound
                label={strings.minStrike}
                value={filters.minStrike}
                onChange={(minStrike) => {
                  update({ minStrike });
                }}
              />
              <StrikeBound
                label={strings.maxStrike}
                value={filters.maxStrike}
                onChange={(maxStrike) => {
                  update({ maxStrike });
                }}
              />
              <label className="flex h-7 items-center gap-2 text-[12px]">
                <Switch
                  size="sm"
                  checked={filters.includeUntraded}
                  onCheckedChange={(includeUntraded) => {
                    update({ includeUntraded });
                  }}
                />
                {strings.includeUntraded(untradedInCycle)}
              </label>
            </div>
            <div
              role="group"
              aria-label={strings.expiry}
              className="mt-2 flex flex-wrap items-center gap-1.5 px-1"
            >
              <span className="text-muted-foreground mr-1 text-[11px] tracking-[0.06em] uppercase">
                {strings.expiry}
              </span>
              {lockedExpiry ? (
                <span className="text-[12px]">
                  <span className="font-mono tabular-nums">{formatSessionDate(lockedExpiry)}</span>
                  <span className="text-muted-foreground ml-2 text-[11px]">
                    {strings.lockedExpiry}
                  </span>
                </span>
              ) : (
                <>
                  <Button
                    type="button"
                    size="xs"
                    variant={expiry === null ? "secondary" : "outline"}
                    aria-pressed={expiry === null}
                    className={CHIP}
                    onClick={() => {
                      update({ expiry: null });
                    }}
                  >
                    {strings.allExpiries}
                  </Button>
                  {expiries.map((option) => (
                    <Button
                      key={option.expiry}
                      type="button"
                      size="xs"
                      variant={expiry === option.expiry ? "secondary" : "outline"}
                      aria-pressed={expiry === option.expiry}
                      onClick={() => {
                        update({ expiry: option.expiry });
                      }}
                      className={`${CHIP} font-mono tabular-nums`}
                    >
                      {formatSessionDate(option.expiry)}
                    </Button>
                  ))}
                </>
              )}
            </div>
          </div>

          <div
            aria-hidden
            className={`${ROW_GRID} text-muted-foreground border-b px-4 py-1.5 text-[11px] tracking-[0.06em] whitespace-nowrap uppercase`}
          >
            <span>{strings.columns.series}</span>
            <span className="text-right">{strings.columns.strike}</span>
            <span className={`${WIDE_ONLY} text-right`}>{strings.columns.distance}</span>
            <span className={WIDE_ONLY}>{strings.columns.moneyness}</span>
            <span className="text-right">{strings.columns.lastPrice}</span>
            <span className={WIDE_ONLY}>{strings.columns.lastSession}</span>
            <span className={`${WIDE_ONLY} text-right`}>{strings.columns.trades}</span>
          </div>

          <CommandStatus>{strings.shown(rows.length, inCycle.length)}</CommandStatus>
          <CommandList className="max-h-none min-h-0 flex-1 p-1">
            <CommandEmpty>{options.length === 0 ? strings.emptyChain : strings.empty}</CommandEmpty>
            {groupByExpiry(rows).map((group) => (
              <CommandGroup
                key={group.expiry}
                heading={
                  expiry === null ? strings.expiryGroup(formatSessionDate(group.expiry)) : undefined
                }
                className="p-0"
              >
                {group.rows.map((row) => (
                  <CommandItem
                    key={row.series.ticker}
                    value={row.series.ticker}
                    data-checked={row.series.ticker === value}
                    onSelect={() => {
                      onChange(row.series.ticker);
                      setOpen(false);
                    }}
                    className="px-3 py-1"
                  >
                    <SeriesRowContent row={row} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>

          <div className="text-muted-foreground flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t px-3 py-2 text-[11px]">
            <span>
              {spot
                ? strings.spot(
                    underlying,
                    formatPriceBRL(decimalStringSchema.parse(spot.value)),
                    formatSessionDate(spot.session),
                  )
                : strings.noSpot}
            </span>
            <span className="font-mono tabular-nums">
              {strings.shown(rows.length, inCycle.length)}
            </span>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
