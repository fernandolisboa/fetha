import type { DecimalString, SessionDate, Ticker } from "@fetha/contracts";
import type { MarketView, OptionRight, TradingSession } from "@fetha/engine";

import { isWithinPlanWindow } from "./plan-window";
import { tradedTickersAt } from "./traded-series";

// A listed series the drag-to-adjust chart can offer as a strike handle position (ticket
// #380): `traded` mirrors `filterToTradedSeries`'s own rule (at least one trade recorded at the
// anchor session) so an untraded strike renders dimmed, or is simply excluded from what a drag
// can snap to, rather than silently letting the engine refuse the plan with `stale_prices` only
// after the user already dropped the handle there.
export interface PlanChainEntry {
  ticker: Ticker;
  right: OptionRight;
  strike: DecimalString;
  expiry: SessionDate;
  traded: boolean;
}

// The monthly-filtered view's own option chain (ticket #380): one entry per series, the latest
// registry record as of `at` (mirroring `seriesFactsOf` in actions.ts), marked traded against
// the same anchor session every plan already prices at.
export function chainFromMonthlyView(
  monthlyView: MarketView,
  session: SessionDate,
  at: string,
): PlanChainEntry[] {
  const traded = tradedTickersAt(monthlyView, session);
  const latestByTicker = new Map<string, MarketView["optionSeries"][number]>();
  for (const series of monthlyView.optionSeries) {
    if (series.asOf > at) continue;
    const current = latestByTicker.get(series.ticker);
    if (!current || series.asOf > current.asOf) latestByTicker.set(series.ticker, series);
  }
  return [...latestByTicker.values()].map((series) => ({
    ticker: series.ticker,
    right: series.right,
    strike: series.strike,
    expiry: series.expiry,
    traded: traded.has(series.ticker),
  }));
}

// The chips for "next monthly expiries" (ticket #380): every distinct expiry in the monthly
// chain that still has at least one traded series, inside the plan's own 20-50-session window
// (round 4 review item 7: outside it, the exit horizon could land in the past or past the
// plan's own ceiling) — closest first, capped at six so the row never wraps past what a
// phone-width chip row can show.
const MAX_EXPIRY_CHIPS = 6;

export function expiryOptionsFrom(
  chain: readonly PlanChainEntry[],
  session: SessionDate,
  calendar: readonly TradingSession[],
): SessionDate[] {
  const expiries = new Set(
    chain.filter((entry) => entry.traded && entry.expiry >= session).map((entry) => entry.expiry),
  );
  return [...expiries]
    .filter((expiry) => isWithinPlanWindow(calendar, session, expiry))
    .sort()
    .slice(0, MAX_EXPIRY_CHIPS);
}
