import { Decimal } from "decimal.js";
import { decimalStringSchema, type DecimalString } from "@fetha/contracts";

import { formatDecimal } from "@/lib/format/decimal";
import { parsePtBrDecimal } from "@/lib/format/parse-decimal";

import type { ChainSeries } from "./types";

export type Moneyness = "in" | "at" | "out";

export interface SeriesFilters {
  query: string;
  expiry: string | null;
  minStrike: string;
  maxStrike: string;
  includeUntraded: boolean;
}

export interface SeriesRow {
  series: ChainSeries;
  distance: DecimalString | null;
  moneyness: Moneyness | null;
}

export interface ExpiryOption {
  expiry: string;
  traded: number;
  total: number;
}

const AT_THE_MONEY_BAND = new Decimal("0.01");
const STRIKE_INPUT_DECIMALS = 8;

export function expiryOptions(series: readonly ChainSeries[]): ExpiryOption[] {
  const byExpiry = new Map<string, ExpiryOption>();
  for (const candidate of series) {
    const option = byExpiry.get(candidate.expiry) ?? {
      expiry: candidate.expiry,
      traded: 0,
      total: 0,
    };
    option.total += 1;
    if (candidate.lastPrice) option.traded += 1;
    byExpiry.set(candidate.expiry, option);
  }
  return [...byExpiry.values()].sort((a, b) => a.expiry.localeCompare(b.expiry));
}

// The nearest cycle that has traded at all: the one a builder usually wants,
// and one whose series the engine can actually price.
export function defaultExpiry(series: readonly ChainSeries[]): string | null {
  const options = expiryOptions(series);
  return (options.find((option) => option.traded > 0) ?? options[0])?.expiry ?? null;
}

// Distance is strike / spot − 1: positive above the spot, negative below.
export function distanceToSpot(strike: string, spot: string): DecimalString | null {
  const spotValue = new Decimal(spot);
  if (spotValue.lte(0)) return null;
  return decimalStringSchema.parse(new Decimal(strike).div(spotValue).minus(1).toFixed(6));
}

export function moneyness(right: string, distance: string | null): Moneyness | null {
  if (distance === null) return null;
  const value = new Decimal(distance);
  if (value.abs().lt(AT_THE_MONEY_BAND)) return "at";
  const strikeAboveSpot = value.isPositive();
  if (right === "call") return strikeAboveSpot ? "out" : "in";
  if (right === "put") return strikeAboveSpot ? "in" : "out";
  return null;
}

function matchesQuery(series: ChainSeries, query: string): boolean {
  const needle = query.trim().toUpperCase();
  if (needle === "") return true;
  if (series.ticker.toUpperCase().includes(needle)) return true;
  const strikeText = formatDecimal(decimalStringSchema.parse(series.strike));
  return strikeText.startsWith(needle.replace(".", ","));
}

function strikeBound(raw: string): Decimal | null {
  return raw.trim() === "" ? null : parsePtBrDecimal(raw, STRIKE_INPUT_DECIMALS);
}

// Within one cycle, priceable series come first (an untraded series is how
// "could not price this operation" happens) and the strike ladder the
// repository already sorted reads top to bottom inside each group.
function byExpiryThenPriceable(a: ChainSeries, b: ChainSeries): number {
  return a.expiry.localeCompare(b.expiry) || (a.lastPrice ? 0 : 1) - (b.lastPrice ? 0 : 1);
}

export function pickerRows(
  series: readonly ChainSeries[],
  filters: SeriesFilters,
  spot: string | null,
): SeriesRow[] {
  const min = strikeBound(filters.minStrike);
  const max = strikeBound(filters.maxStrike);
  return series
    .filter((candidate) => filters.includeUntraded || candidate.lastPrice !== null)
    .filter((candidate) => filters.expiry === null || candidate.expiry === filters.expiry)
    .filter((candidate) => min === null || new Decimal(candidate.strike).gte(min))
    .filter((candidate) => max === null || new Decimal(candidate.strike).lte(max))
    .filter((candidate) => matchesQuery(candidate, filters.query))
    .slice()
    .sort(byExpiryThenPriceable)
    .map((candidate) => {
      const distance = spot === null ? null : distanceToSpot(candidate.strike, spot);
      return { series: candidate, distance, moneyness: moneyness(candidate.right, distance) };
    });
}
