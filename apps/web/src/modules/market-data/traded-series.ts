import type { SessionDate } from "@fetha/contracts";
import type { MarketView } from "@fetha/engine";

// The plan's own series rule, "only series that traded at the last close": narrows the view's
// option chain to tickers with at least one trade recorded at `session`
// before the engine's own moneyness rule ever sees it, so a leg's selected strike can never be
// one nothing traded that close — `LegValuation.stale`/`price === null` stay as a guard
// (`generatePlan`'s refusal), not the only thing standing between a thin chain and a bad plan.
export function filterToTradedSeries(view: MarketView, session: SessionDate): MarketView {
  const tradedTickers = new Set(
    view.optionPrices
      .filter((price) => price.session === session && price.trades > 0)
      .map((price) => price.ticker),
  );
  return {
    ...view,
    optionSeries: view.optionSeries.filter((series) => tradedTickers.has(series.ticker)),
  };
}
