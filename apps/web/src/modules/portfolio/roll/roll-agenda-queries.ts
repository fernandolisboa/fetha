import { cache } from "react";
import { decimalStringSchema, type SessionDate, type Ticker } from "@fetha/contracts";

import { getDb, type Database } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { recordAccess } from "@/modules/audit";
import { requireUser } from "@/modules/auth";
import {
  countSessionsClosedAfter,
  latestCandle,
  tradingSessionForDate,
} from "@/modules/market-data";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";

import { holdingKey } from "../bookkeeping";
import { openOperationPlansFor } from "../held-operations";
import { seriesByHolding } from "../portfolio-service";

import { buildRollAgenda, type RollAgendaInput, type RollAgendaItem } from "./roll-agenda";
import { isShortLegAssignmentRisk } from "./roll-assignment-risk";

// The agenda's own trigger when an operation cannot be linked to a saved plan (ADR-0080
// addendum "agenda trigger without a plan link"): nothing in the `operations` table names which
// structure, if any, it was planned from, so every operation with an open option leg uses this
// one documented default, the same five-session default `plans/exit-rules.ts`'s own
// `DEFAULT_ROLL_SESSIONS_BEFORE_EXPIRY` names for a plan's own roll rule. Duplicated here rather
// than imported: `plans` does not export it, and `portfolio` reading it would couple a frozen
// module boundary (ADR-0079) to a number that is a coincidence of today's catalog, not a shared
// invariant.
const DEFAULT_ROLL_SESSIONS_BEFORE_EXPIRY = 5;

// Each open operation's own `RollAgendaInput`, read from the already-loaded plan
// (`openOperationPlansFor`, narrow and markToMarket-free, #382 review advisory: Início and
// Carteira never need the full engine-valued portfolio just to show the agenda) plus the
// underlying's last close and the calendar's own session count to expiry — never a number this
// module computes itself (CLAUDE.md principle 1): strike and spot are the engine's own series
// facts and the latest ingested candle, compared by `isShortLegAssignmentRisk`. Parameterized by
// `db`/`user` so an integration test can exercise it for two different users without a request
// context.
export async function rollAgendaFor(db: Database, user: ScopedUser): Promise<RollAgendaItem[]> {
  const plans = await openOperationPlansFor(db, user);
  const candidates = plans.filter(
    ({ pendingSettlement, heldExpiry, legs }) =>
      !pendingSettlement && heldExpiry !== null && legs.some((leg) => leg.role !== "stock"),
  );
  if (candidates.length === 0) {
    return [];
  }

  const inputs: RollAgendaInput[] = [];
  const candleByUnderlying = new Map<Ticker, { session: SessionDate; close: string } | null>();
  for (const { operationId, underlying, legs, heldExpiry, fills } of candidates) {
    if (!heldExpiry) continue;
    if (!candleByUnderlying.has(underlying)) {
      candleByUnderlying.set(underlying, (await latestCandle(db, underlying)) ?? null);
    }
    const candle = candleByUnderlying.get(underlying) ?? null;

    const series = await seriesByHolding(db, fills);
    const anyShortLegInTheMoney =
      candle !== null &&
      legs
        .filter((leg) => leg.role !== "stock" && leg.side === "sell")
        .some((leg) => {
          const facts = series.get(holdingKey(leg.ticker, heldExpiry));
          if (!facts) return false;
          return isShortLegAssignmentRisk(
            facts.right,
            decimalStringSchema.parse(facts.strike),
            decimalStringSchema.parse(candle.close),
          );
        });

    const expirySession = await tradingSessionForDate(db, heldExpiry);
    if (!expirySession || !candle) continue;
    // Anchored on today, not on the latest ingested candle's own session (#382 review
    // advisory "session count anchor"): a candle that lags by one session (ingestion has not
    // run yet today) would overcount every expiry by one session and the "vence hoje" branch
    // (count === 0) could never fire on the expiry day itself.
    const sessionsToExpiry = await countSessionsClosedAfter(
      db,
      todaySaoPauloDate(),
      new Date(expirySession.close),
    );

    inputs.push({
      operationId,
      underlying,
      expiry: heldExpiry,
      sessionsToExpiry,
      anyShortLegInTheMoney,
      rollTriggerSessions: DEFAULT_ROLL_SESSIONS_BEFORE_EXPIRY,
    });
  }

  return buildRollAgenda(inputs);
}

export const getMyRollAgenda = cache(async (): Promise<RollAgendaItem[]> => {
  const user = await requireUser();
  await recordAccess("portfolio_read");
  return rollAgendaFor(getDb(), user);
});
