// A client-safe barrel: the shell module's default entry point
// (`@/modules/shell`) also re-exports `AppShell`, which pulls in the
// server-only account menu (`next/headers`). A "use client" component in
// another module needs `Panel`, `EmptyState` or the market bar's publish
// hook without dragging that whole graph into its bundle.
export { EmptyState } from "./components/empty-state";
export {
  usePublishMarketBarInstrument,
  type MarketBarInstrument,
} from "./components/market-bar-context";
export { Panel } from "./components/panel";
