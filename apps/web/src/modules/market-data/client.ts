// A client-safe barrel: the market-data module's default entry point
// (`@/modules/market-data`) also re-exports repositories and ingest code
// that import `@/db/client` and other server-only modules. A "use client"
// component needs types like `InstrumentSearchResult` without dragging that
// server graph into its bundle.
export type { InstrumentSearchResult } from "./repositories/candle-repository";
export {
  closeFreshnessKind,
  sessionDateToDisplayDate,
  type CloseFreshness,
} from "./close-freshness";
export {
  exchangeRateHref,
  matchExchangeRates,
  type ExchangeRateSearchHit,
} from "./exchange-rate-match";
// `marketIndexes` and `marketIndexTickersForQuery` are used only inside `market-data` itself
// (`ingest.ts`, `candle-repository.ts`), through a direct relative import, not this barrel.
export { ibovespa, isMarketIndex } from "./market-index";
// The module's own locale choice (`t`), plain data with no server imports:
// safe for a client component that needs exchangeRate.pairLabel (#305).
export { t as marketDataT } from "./strings";
export { AssetReadingChips } from "./components/asset-reading";
