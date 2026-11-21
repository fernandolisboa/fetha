import type { SessionDate, Ticker } from "@fetha/contracts";
import type { OptionRight } from "@fetha/engine";

import type { Database } from "@/db/client";
import { isProductionDeployment, readE2ESecret } from "@/modules/auth";
import {
  buildOperationMarketView,
  filterToMonthlyExpiries,
  filterToTradedSeries,
  latestCandle,
  tradingSessionForDate,
} from "@/modules/market-data";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";

import { selectNextMonthlySeries } from "./roll-series-selection";

export interface RollPairCandidate {
  underlying: Ticker;
  right: OptionRight;
  session: SessionDate;
  ticker: Ticker;
  strike: string;
  close: string;
  expiry: SessionDate;
  nextExpiry: SessionDate;
  nextTicker: Ticker;
}

export type SeedE2ERollPairResult =
  | { ok: true; pair: RollPairCandidate }
  | { ok: false; reason: "e2e_not_available" | "no_roll_pair" };

// E2E only: `roll.spec.ts` (#382) needs an open operation whose monthly expiry's own "next
// monthly expiry" also carries a traded series of the same right, read directly off whatever the
// preview actually ingested rather than a hardcoded ticker (apps/web/e2e/README.md) — the chain
// only shrinks as near-month expiries roll off, so a fixed pair would eventually go stale. Picks
// the first right (call, then put) whose two nearest unexpired monthly expiries both traded at
// the newest session, and resolves the exact opening series through `selectNextMonthlySeries`,
// the same selection a real roll makes, so the spec can assert the dialog's "to open" order by
// ticker rather than merely by its presence.
export async function seedE2ERollPair(
  db: Database,
  underlying: Ticker,
): Promise<SeedE2ERollPairResult> {
  if (isProductionDeployment() || !readE2ESecret()) {
    return { ok: false, reason: "e2e_not_available" };
  }

  const candle = await latestCandle(db, underlying);
  if (!candle) return { ok: false, reason: "no_roll_pair" };
  const trading = await tradingSessionForDate(db, candle.session);
  if (!trading) return { ok: false, reason: "no_roll_pair" };

  const rawView = await buildOperationMarketView(db, underlying, trading.close);
  const view = filterToTradedSeries(filterToMonthlyExpiries(rawView), trading.date);
  // The held leg must still be open by the time the spec records it, not merely unexpired as
  // of the ingested session: the real wall clock runs well past the e2e dataset's fixed
  // sessions, so "unexpired" is judged against today, not against `trading.date`.
  const today = todaySaoPauloDate();

  const rights: OptionRight[] = ["call", "put"];
  for (const right of rights) {
    const expiries = [
      ...new Set(
        view.optionSeries
          .filter((series) => series.right === right && series.expiry > today)
          .map((series) => series.expiry),
      ),
    ].sort();
    const [near, next] = expiries;
    if (near === undefined || next === undefined) continue;

    const nearSeries = view.optionSeries.find(
      (series) => series.right === right && series.expiry === near,
    );
    if (!nearSeries) continue;

    const price = view.optionPrices.find(
      (candidate) => candidate.ticker === nearSeries.ticker && candidate.session === trading.date,
    );
    if (!price?.close) continue;

    const selection = selectNextMonthlySeries(view.optionSeries, {
      underlying,
      right,
      currentExpiry: near,
      currentStrike: nearSeries.strike,
    });
    if (!selection.ok) continue;

    return {
      ok: true,
      pair: {
        underlying,
        right,
        session: trading.date,
        ticker: nearSeries.ticker,
        strike: nearSeries.strike,
        close: price.close,
        expiry: near,
        nextExpiry: next,
        nextTicker: selection.series.ticker,
      },
    };
  }
  return { ok: false, reason: "no_roll_pair" };
}
