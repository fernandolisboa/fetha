import { instantSchema, tickerSchema } from "@fetha/contracts";
import { engine } from "@fetha/engine";

import type { Database } from "@/db/client";

import { buildOperationMarketView, MarketViewUnavailableError } from "./market-view";
import { latestSessionOnOrBefore } from "./repositories/calendar-repository";
import { latestMacroPointAtOrBefore } from "./repositories/macro-repository";
import {
  underlyingsToComputeForSession,
  underlyingsWithPointOnSession,
  upsertIvIndexPoints,
} from "./repositories/iv-index-repository";

export interface ComputeIvIndexResult {
  rowCount: number;
  pending: boolean;
}

// A session whose only visible CDI point predates the previous trading
// session would make the engine default r=0 silently (`resolveRiskFreeRate`),
// baking a wrong rate into a point that is never recomputed once persisted
// (docs/adr/0054). Left pending instead, so the next run retries it once the
// rate lands. A session with no earlier trading session is the floor of the
// history: CDI is ingested from the calendar's own first day
// (`SGS_DEFAULT_SINCE`, ingest.ts) and each point is visible only from the
// next session's open, so no rate can ever be visible at its close. It is
// terminal instead of pending forever (#264).
async function cdiEligibility(
  db: Database,
  sessionClose: Date,
): Promise<"eligible" | "pending" | "never"> {
  const previousSession = await latestSessionOnOrBefore(db, new Date(sessionClose.getTime() - 1));
  const cdi = await latestMacroPointAtOrBefore(db, "cdi", sessionClose);
  if (!cdi) {
    return previousSession ? "pending" : "never";
  }
  return !previousSession || cdi.date >= previousSession.date ? "eligible" : "pending";
}

export async function computeIvIndexForSession(
  db: Database,
  session: string,
  sessionClose: Date,
  hardStopAt = Infinity,
): Promise<ComputeIvIndexResult> {
  const eligibility = await cdiEligibility(db, sessionClose);
  if (eligibility !== "eligible") {
    return { rowCount: 0, pending: eligibility === "pending" };
  }

  const allUnderlyings = await underlyingsToComputeForSession(db, session);
  const done = new Set(await underlyingsWithPointOnSession(db, session));
  const remaining = allUnderlyings.filter((underlying) => !done.has(underlying));

  const at = instantSchema.parse(sessionClose.toISOString());
  const rows: Parameters<typeof upsertIvIndexPoints>[1] = [];
  let pending = false;

  for (const underlying of remaining) {
    if (Date.now() >= hardStopAt) {
      pending = true;
      break;
    }

    const ticker = tickerSchema.parse(underlying);
    let view;
    try {
      view = await buildOperationMarketView(db, ticker, at);
    } catch (error) {
      if (error instanceof MarketViewUnavailableError) {
        pending = true;
        continue;
      }
      throw error;
    }

    // `buildOperationMarketView` carries each option's latest price over a
    // trailing window (`latestOptionPricesAt`), not just `session`'s own: a
    // bracket with no trade on `session` must be treated as unpriced here,
    // not solved from a stale premium.
    const optionPrices = view.optionPrices.filter((price) => price.session === session);

    const result = await engine.impliedVolatilityIndex({
      view: { ...view, optionPrices },
      underlying: ticker,
      at,
    });

    if (!result.ok) {
      pending = true;
      continue;
    }
    if (result.value.impliedVolatility === null) {
      continue;
    }

    rows.push({
      underlying: ticker,
      session,
      asOf: sessionClose,
      impliedVolatility: result.value.impliedVolatility,
      method: result.value.method,
    });
  }

  const rowCount = await upsertIvIndexPoints(db, rows);
  return { rowCount, pending };
}
