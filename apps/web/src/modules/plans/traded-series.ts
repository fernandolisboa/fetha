import type { SessionDate, Ticker } from "@fetha/contracts";
import type { MarketView } from "@fetha/engine";

// Every ticker with at least one trade recorded at `session` (shared by `filterToTradedSeries`
// below and the drag-to-adjust chart's own chain, `chainFromMonthlyView` — one rule for "did
// this series trade that close", not two copies of the same filter).
export function tradedTickersAt(view: MarketView, session: SessionDate): Set<Ticker> {
  return new Set(
    view.optionPrices
      .filter((price) => price.session === session && price.trades > 0)
      .map((price) => price.ticker),
  );
}

// The plan's own series rule, round 3 review's "only series that traded at the last close":
// narrows the view's option chain to tickers with at least one trade recorded at `session`
// before the engine's own moneyness rule ever sees it, so a leg's selected strike can never be
// one nothing traded that close — `LegValuation.stale`/`price === null` stay as a guard
// (`generatePlan`'s refusal), not the only thing standing between a thin chain and a bad plan.
export function filterToTradedSeries(view: MarketView, session: SessionDate): MarketView {
  const tradedTickers = tradedTickersAt(view, session);
  return {
    ...view,
    optionSeries: view.optionSeries.filter((series) => tradedTickers.has(series.ticker)),
  };
}
