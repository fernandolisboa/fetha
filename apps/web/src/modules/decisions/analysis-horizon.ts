import type { AnalysisOutlookHorizon, SessionDate } from "@fetha/contracts";

import type { Database } from "@/db/client";
import {
  latestSessionOnOrBefore,
  nthTradingSessionAfter,
  tradingSessionOnOrAfter,
} from "@/modules/market-data";

// docs/adr/0058: the anchor is the latest session already closed when the
// analysis was requested, the same session the facts were priced at. Null
// when the calendar cannot place the horizon, or would place it on a close
// that was already public at the request instant.
export async function resolveOutlookHorizon(
  db: Database,
  horizon: AnalysisOutlookHorizon,
  requestedAt: Date,
): Promise<SessionDate | null> {
  const session =
    horizon.kind === "expiry"
      ? await tradingSessionOnOrAfter(db, horizon.expiry)
      : await nthAfterAnchor(db, horizon.count, requestedAt);
  if (!session || new Date(session.close).getTime() <= requestedAt.getTime()) {
    return null;
  }
  return session.date;
}

async function nthAfterAnchor(db: Database, count: number, requestedAt: Date) {
  const anchor = await latestSessionOnOrBefore(db, requestedAt);
  return anchor ? nthTradingSessionAfter(db, anchor.date, count) : undefined;
}
