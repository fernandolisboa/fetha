import { cache } from "react";
import type { SessionDate, Ticker } from "@fetha/contracts";

import { getDb } from "@/db/client";
import {
  countSessionsClosedAfter,
  latestCandle,
  tradingSessionForDate,
} from "@/modules/market-data";

import { holdingKey } from "../bookkeeping";
import { distanceToSpot, moneyness } from "../builder/series-picker-model";
import { getMyPortfolio } from "../portfolio-queries";
import { seriesByHolding } from "../portfolio-service";

import { buildRollAgenda, type RollAgendaInput, type RollAgendaItem } from "./roll-agenda";

// The agenda's own trigger when an operation cannot be linked to a saved plan (ADR-0080
// addendum "agenda trigger without a plan link"): nothing in the `operations` table names which
// structure, if any, it was planned from, so every operation with an open option leg uses this
// one documented default, the same five-session default `plans/exit-rules.ts`'s own
// `DEFAULT_ROLL_SESSIONS_BEFORE_EXPIRY` names for a plan's own roll rule. Duplicated here rather
// than imported: `plans` does not export it, and `portfolio` reading it would couple a frozen
// module boundary (ADR-0079) to a number that is a coincidence of today's catalog, not a shared
// invariant.
const DEFAULT_ROLL_SESSIONS_BEFORE_EXPIRY = 5;

// Each open operation's own `RollAgendaInput`, read from the already-loaded portfolio
// (`getMyPortfolio`, React-cached so the Início and Carteira pages share one read) plus the
// underlying's last close and the calendar's own session count to expiry — never a number this
// module computes itself (CLAUDE.md principle 1): `moneyness` and `distanceToSpot` are the same
// pure functions the builder's own series picker already uses.
export const getMyRollAgenda = cache(async (): Promise<RollAgendaItem[]> => {
  const db = getDb();
  const model = await getMyPortfolio();
  const candidates = model.operations.filter(
    ({ operation, state, heldExpiry, pendingSettlement }) =>
      operation.status === "open" &&
      !pendingSettlement &&
      heldExpiry !== null &&
      state !== null &&
      state.legs.some((leg) => leg.role !== "stock"),
  );
  if (candidates.length === 0) {
    return [];
  }

  const inputs: RollAgendaInput[] = [];
  const candleByUnderlying = new Map<Ticker, { session: SessionDate; close: string } | null>();
  for (const { operation, state, heldExpiry } of candidates) {
    if (!state || !heldExpiry) continue;
    const underlying = operation.underlying;
    if (!candleByUnderlying.has(underlying)) {
      candleByUnderlying.set(underlying, (await latestCandle(db, underlying)) ?? null);
    }
    const candle = candleByUnderlying.get(underlying) ?? null;

    const operationFills = model.fills.filter((fill) => fill.operationId === operation.id);
    const series = await seriesByHolding(db, operationFills);
    const anyShortLegInTheMoney =
      candle !== null &&
      state.legs
        .filter((leg) => leg.role !== "stock" && leg.side === "sell")
        .some((leg) => {
          const facts = series.get(holdingKey(leg.ticker, heldExpiry));
          if (!facts) return false;
          const distance = distanceToSpot(facts.strike, candle.close);
          return moneyness(facts.right, distance) === "in";
        });

    const expirySession = await tradingSessionForDate(db, heldExpiry);
    if (!expirySession || !candle) continue;
    const sessionsToExpiry = await countSessionsClosedAfter(
      db,
      candle.session,
      new Date(expirySession.close),
    );

    inputs.push({
      operationId: operation.id,
      underlying,
      expiry: heldExpiry,
      sessionsToExpiry,
      anyShortLegInTheMoney,
      rollTriggerSessions: DEFAULT_ROLL_SESSIONS_BEFORE_EXPIRY,
    });
  }

  return buildRollAgenda(inputs);
});
