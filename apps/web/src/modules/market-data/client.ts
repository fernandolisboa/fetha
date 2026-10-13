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
// marketDataStrings is plain data, no server imports: safe for a client
// component (command-search.tsx) that needs exchangeRate.pairLabel without
// duplicating it (#305 review).
export { marketDataStrings } from "./strings";
