export { allGaps, freshness, gaps, latestSession, type SourceFreshness } from "./freshness";
export {
  closeFreshnessKind,
  sessionDateToDisplayDate,
  type CloseFreshness,
} from "./close-freshness";
export { ingest, type IngestOptions, type IngestOutcome, type SourceOutcome } from "./ingest";
export { loadCandleSeries } from "./candle-series";
export {
  calendarUpTo,
  canSatisfyCollection,
  loadMarketView,
  previousTradingSession,
  tradingSessionForDate,
} from "./market-view";
// Market data is read-only to user-facing code (CLAUDE.md principle 5):
// upsertDailyCandles/upsertTradingSessions stay module-private, written
// only from ./ingest; tests that need to seed rows import the repository
// path directly (see watchlist/actions.integration.test.ts).
export {
  candleSessionBoundsInRange,
  latestCandle,
  searchInstruments,
  type CandleRow,
  type InstrumentSearchResult,
} from "./repositories/candle-repository";
export { CandleChart } from "./components/candle-chart";
export { CandleFormToggle } from "./components/candle-form-toggle";
export { InstrumentMarketBar } from "./components/instrument-market-bar";
export { marketDataStrings, t } from "./strings";
export {
  buildOperationMarketView,
  MarketViewTooLargeError,
  MarketViewUnavailableError,
} from "./market-view";
export {
  expiryByTicker,
  optionChainForUnderlying,
  type ChainSeries,
} from "./repositories/option-repository";
export { latestSessionOnOrBefore } from "./repositories/calendar-repository";
