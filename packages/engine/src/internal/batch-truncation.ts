import type { Instant, Ticker } from "@fetha/contracts";
import type {
  Candle,
  CorporateActionFactor,
  DividendYieldPoint,
  ImpliedVolatilityIndexPoint,
  MacroPoint,
  MarketViewCollection,
  TruncationReport,
} from "../api";
import { isAfter } from "./instant";
import { sortedEntries } from "./order";

export type BatchTruncationInput = {
  candles: readonly Candle[];
  corporateActions: readonly CorporateActionFactor[];
  impliedVolatilityIndex: readonly ImpliedVolatilityIndexPoint[];
  macro: readonly MacroPoint[];
  dividendYields: readonly DividendYieldPoint[];
  instruments: readonly Ticker[];
  at: Instant;
  needsIv: boolean;
};

function accumulateGlobal<T>(
  rows: readonly T[],
  asOfOf: (row: T) => Instant,
  collection: MarketViewCollection,
  at: Instant,
  out: TruncationReport[],
): void {
  const dropped = rows.filter((row) => isAfter(asOfOf(row), at)).length;
  if (dropped > 0) {
    out.push({ collection, ticker: null, dropped, reason: "after_at" });
  }
}

function accumulate<T>(
  rows: readonly T[],
  tickerOf: (row: T) => Ticker,
  asOfOf: (row: T) => Instant,
  collection: MarketViewCollection,
  instrumentSet: ReadonlySet<Ticker>,
  at: Instant,
  out: TruncationReport[],
): void {
  const afterAt = new Map<string, number>();
  const unreferenced = new Map<string, number>();
  for (const row of rows) {
    const ticker = tickerOf(row);
    if (!instrumentSet.has(ticker)) {
      unreferenced.set(ticker, (unreferenced.get(ticker) ?? 0) + 1);
      continue;
    }
    if (isAfter(asOfOf(row), at)) {
      afterAt.set(ticker, (afterAt.get(ticker) ?? 0) + 1);
    }
  }
  for (const [ticker, dropped] of sortedEntries(afterAt)) {
    out.push({ collection, ticker, dropped, reason: "after_at" });
  }
  for (const [ticker, dropped] of sortedEntries(unreferenced)) {
    out.push({ collection, ticker, dropped, reason: "unreferenced_instrument" });
  }
}

export function batchTruncationReport(input: BatchTruncationInput): TruncationReport[] {
  const instrumentSet = new Set(input.instruments);
  const out: TruncationReport[] = [];
  accumulate(
    input.candles,
    (c) => c.ticker,
    (c) => c.asOf,
    "candles",
    instrumentSet,
    input.at,
    out,
  );
  accumulate(
    input.corporateActions,
    (f) => f.ticker,
    (f) => f.asOf,
    "corporateActions",
    instrumentSet,
    input.at,
    out,
  );
  if (input.needsIv) {
    accumulate(
      input.impliedVolatilityIndex,
      (p) => p.underlying,
      (p) => p.asOf,
      "impliedVolatilityIndex",
      instrumentSet,
      input.at,
      out,
    );
  }
  accumulateGlobal(input.macro, (p) => p.asOf, "macro", input.at, out);
  accumulate(
    input.dividendYields,
    (p) => p.underlying,
    (p) => p.asOf,
    "dividendYields",
    instrumentSet,
    input.at,
    out,
  );
  return out;
}
