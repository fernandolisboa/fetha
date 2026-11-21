import { cache } from "react";
import {
  decimalStringSchema,
  type DecimalString,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";
import type { OptionRight } from "@fetha/engine";

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

import { openOperationPlansFor } from "../held-operations";

import { buildRollAgenda, type RollAgendaInput, type RollAgendaItem } from "./roll-agenda";
import { isInTheMoney, isShortLegAssignmentRisk } from "./roll-assignment-risk";

// The agenda's own trigger when an operation cannot be linked to a saved plan (ADR-0080):
// nothing in the `operations` table names which structure, if any, it was planned from, so every
// operation with an open option leg uses this one documented default, the same five-session
// default `plans/exit-rules.ts`'s own `DEFAULT_ROLL_SESSIONS_BEFORE_EXPIRY` names for a plan's
// own roll rule. Duplicated here rather than imported: `plans` depends on `portfolio`, so
// `portfolio` importing from `plans` would be a cycle, and the number is a coincidence of
// today's catalog, not a shared invariant worth breaking that boundary for.
const DEFAULT_ROLL_SESSIONS_BEFORE_EXPIRY = 5;

// Each open operation's own `RollAgendaInput`, read from the already-loaded plan
// (`openOperationPlansFor`, narrow and markToMarket-free: Início and Carteira never need the
// full engine-valued portfolio just to show the agenda) plus the underlying's last close and the
// calendar's own session count to expiry — never a number this module computes itself (CLAUDE.md
// principle 1): the market-data strike and close, compared in `roll-assignment-risk.ts`.
// Parameterized by `db`/`user`/`today` so an integration test can exercise it for two different
// users, and a fixed calendar date, without a request context.
export async function rollAgendaFor(
  db: Database,
  user: ScopedUser,
  today: SessionDate = todaySaoPauloDate(),
): Promise<RollAgendaItem[]> {
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
  for (const { operationId, underlying, legs, heldExpiry } of candidates) {
    if (!heldExpiry) continue;
    // Missing from the calendar entirely, never just missing a price (#382): without the expiry
    // date's own session row there is no `sessionsToExpiry` to anchor any suggestion on, and no
    // "watch, we don't know" is possible either.
    const expirySession = await tradingSessionForDate(db, heldExpiry);
    if (!expirySession) continue;
    const sessionsToExpiry = await countSessionsClosedAfter(
      db,
      today,
      new Date(expirySession.close),
    );

    if (!candleByUnderlying.has(underlying)) {
      candleByUnderlying.set(underlying, (await latestCandle(db, underlying)) ?? null);
    }
    const candle = candleByUnderlying.get(underlying) ?? null;
    const optionLegs = legs.filter((leg) => leg.role !== "stock");
    const hasShortLeg = optionLegs.some((leg) => leg.side === "sell");

    // Unknown, not "out of the money", when a candle or a leg's own strike and right (already
    // read by `openOperationPlansFor`, never a second `seriesByHolding` call here) are missing
    // (#382): the agenda still lists the operation, it just cannot tell `let_expire` from
    // `watch` without a spot price and a strike for every leg.
    const spotClose = candle?.close ?? null;
    const moneynessKnown =
      spotClose !== null && optionLegs.every((leg) => leg.strike !== null && leg.right !== null);
    const anyLegInTheMoney = (
      side: "buy" | "sell",
      inTheMoney: (right: OptionRight, strike: DecimalString, spot: DecimalString) => boolean,
    ) =>
      moneynessKnown &&
      optionLegs
        .filter((leg) => leg.side === side)
        .some((leg) => {
          if (leg.strike === null || leg.right === null) return false;
          return inTheMoney(
            leg.right,
            decimalStringSchema.parse(leg.strike),
            decimalStringSchema.parse(spotClose),
          );
        });

    inputs.push({
      operationId,
      underlying,
      expiry: heldExpiry,
      sessionsToExpiry,
      hasShortLeg,
      anyShortLegInTheMoney: anyLegInTheMoney("sell", isShortLegAssignmentRisk),
      anyLongLegInTheMoney: anyLegInTheMoney("buy", isInTheMoney),
      moneynessKnown,
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
