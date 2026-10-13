import { decimalStringSchema, type Ticker } from "@fetha/contracts";
import type { MarketView } from "@fetha/engine";

import type { Database } from "@/db/client";

import { buildAssetReadingView } from "./asset-reading";
import { toTradingSession } from "./market-view";
import { recentSessions, sessionByDate, sessionsInRange } from "./repositories/calendar-repository";
import { liquidOptionableUnderlyings } from "./repositories/iv-index-repository";
import { latestMacroPointAtOrBefore } from "./repositories/macro-repository";

export interface LiquidityRule {
  windowSessions: number;
  minTradedSessions: number;
}

// The underlyings the radar reads at `session` (docs/adr/0066), or null when the calendar does
// not hold `session`.
export async function radarUniverse(
  db: Database,
  session: string,
  rule: LiquidityRule,
): Promise<string[] | null> {
  const trading = await sessionByDate(db, session);
  if (!trading) {
    return null;
  }
  const window = await recentSessions(db, trading.close, rule.windowSessions);
  const fromSession = window[0]?.date ?? session;
  return liquidOptionableUnderlyings(db, session, fromSession, rule.minTradedSessions);
}

// The asset reading's view (candles, IV points and the chain listed at the reading session with
// that session's prices) plus what pricing a leg selection needs on top: the CDI visible at `at`
// and the calendar through the chain's furthest expiry, or time to expiry reports a calendar gap.
export async function buildRadarView(db: Database, ticker: Ticker, at: Date): Promise<MarketView> {
  const view = await buildAssetReadingView(db, ticker, at);
  const lastSession = view.calendar.at(-1);
  const furthestExpiry = view.optionSeries.reduce<string | null>(
    (furthest, series) =>
      furthest === null || series.expiry > furthest ? series.expiry : furthest,
    null,
  );
  const [futureRows, cdi] = await Promise.all([
    lastSession && furthestExpiry && furthestExpiry > lastSession.date
      ? sessionsInRange(
          db,
          new Date(new Date(lastSession.close).getTime() + 1),
          new Date(`${furthestExpiry}T23:59:59.999Z`),
        )
      : Promise.resolve([]),
    latestMacroPointAtOrBefore(db, "cdi", at),
  ]);
  return {
    ...view,
    calendar: [...view.calendar, ...futureRows.map(toTradingSession)],
    macro: cdi
      ? [
          {
            series: "cdi",
            date: cdi.date,
            asOf: cdi.asOf.toISOString(),
            annualRate: decimalStringSchema.parse(cdi.annualRate),
          },
        ]
      : [],
  };
}
