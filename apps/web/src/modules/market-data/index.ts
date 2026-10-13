export { allGaps, freshness, gaps, latestSession, type SourceFreshness } from "./freshness";
export {
  closeFreshnessKind,
  sessionDateToDisplayDate,
  type CloseFreshness,
} from "./close-freshness";
export { ingest, type IngestOptions, type IngestOutcome, type SourceOutcome } from "./ingest";
export { loadCandleSeries } from "./candle-series";
export { loadAssetReading } from "./asset-reading";
export { buildRadarView, radarUniverse, type LiquidityRule } from "./radar-view";
export { AssetReadingChips, AssetReadingPanel } from "./components/asset-reading";
export {
  calendarUpTo,
  loadMarketView,
  loadMarketViewWithCalendarVersion,
  nthTradingSessionAfter,
  previousTradingSession,
  tradingSessionForDate,
  tradingSessionOnOrAfter,
  type MarketViewWithCalendarVersion,
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
export { marketDataStrings, t } from "./strings";
export {
  buildOperationMarketView,
  corporateActionFactorsForUnderlying,
  MarketViewTooLargeError,
  MarketViewUnavailableError,
  type BuildOperationMarketViewOptions,
} from "./market-view";
export {
  expiryByTicker,
  latestExpiredTradedSeries,
  optionChainForUnderlying,
  optionSeriesDetail,
  optionSeriesForFills,
  seriesKey,
  type ChainSeries,
  type OptionSeriesDetail,
  type OptionSeriesPrice,
  type OptionSeriesSearchResult,
  type ResolvedOptionSeries,
} from "./repositories/option-repository";
export { buildPortfolioMarketView } from "./portfolio-view";
export { latestSessionOnOrBefore } from "./repositories/calendar-repository";
export { searchOptionSeriesAction, type SearchOptionSeriesResult } from "./actions";
export { OptionSeriesPricesTable } from "./components/option-series-prices-table";
export {
  recordCorporateActionFactorAction,
  type RecordCorporateActionFactorResult,
} from "./corporate-action-actions";
export {
  recentCorporateActionFactorsList,
  type RecentCorporateActionFactor,
} from "./corporate-action-queries";
export { CorporateActionPanel } from "./components/corporate-action-panel";
export {
  exchangeRateHref,
  matchExchangeRates,
  type ExchangeRateSearchHit,
} from "./exchange-rate-match";
export { exchangeRatePairSchema, type ExchangeRatePair } from "./adapters/bacen-sgs/schema";
export { RateLineChart, type RatePoint } from "./components/rate-line-chart";
export {
  exchangeRateSeries,
  latestExchangeRate,
  type ExchangeRateRow,
} from "./repositories/exchange-rate-repository";
export { companyFilingsForInstrument, type CompanyFilingsView } from "./company-filing-queries";
export {
  isMarketIndex,
  marketIndexes,
  marketIndexOf,
  marketIndexTickersForQuery,
  type MarketIndex,
} from "./market-index";
export { CompanyFilingsList } from "./components/company-filings-list";
