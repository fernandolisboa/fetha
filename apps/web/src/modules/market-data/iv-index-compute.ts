import { instantSchema, tickerSchema } from "@fetha/contracts";
import { engine } from "@fetha/engine";

import type { Database } from "@/db/client";

import { buildOperationMarketView } from "./market-view";
import {
  underlyingsToComputeForSession,
  upsertIvIndexPoints,
} from "./repositories/iv-index-repository";

// One point per underlying for `session`, stamped with `sessionClose`
// (the same instant COTAHIST candles of that session carry, docs/adr/0051):
// a null result (no bracket, ADR-0013's `iv_index_not_bracketed`) or an
// engine error for one underlying is skipped rather than failing the whole
// session — the underlying stays without a point for this session, retried
// automatically by the next backfill pass, never blocking every other
// underlying's point from being written (docs/adr/0054).
export async function computeIvIndexForSession(
  db: Database,
  session: string,
  sessionClose: Date,
): Promise<number> {
  const underlyings = await underlyingsToComputeForSession(db, session);
  const at = instantSchema.parse(sessionClose.toISOString());

  const rows: Parameters<typeof upsertIvIndexPoints>[1] = [];
  for (const underlying of underlyings) {
    const ticker = tickerSchema.parse(underlying);
    try {
      const view = await buildOperationMarketView(db, ticker, at);
      const result = await engine.impliedVolatilityIndex({ view, underlying: ticker, at });
      if (!result.ok || result.value.impliedVolatility === null) {
        continue;
      }
      rows.push({
        underlying: ticker,
        session,
        asOf: sessionClose,
        impliedVolatility: result.value.impliedVolatility,
        method: result.value.method,
      });
    } catch {
      continue;
    }
  }

  return upsertIvIndexPoints(db, rows);
}
