import type { EngineError, MarketView, Operation, TradingSession } from "../api";
import { sessionByDate } from "./calendar";
import { invariant } from "./invariant";

// Shared by markToMarket and proposeSettlement (round 3 item 10): both resolve the exact
// `TradingSession` for an operation's own listed expiry, and both report the same
// `insufficient_data` shape — a midnight-UTC instant on that date, purely informational, since
// resolving a real open/close instant is exactly what a calendar gap is missing — when the
// calendar has no row for it at all. The caller is responsible for `operation.expiry` already
// being set; a `null` expiry reaching this call is a caller bug, not user input.
export function resolveExpiryClose(
  view: MarketView,
  operation: Operation,
): { ok: true; session: TradingSession } | { ok: false; error: EngineError } {
  const expiry = operation.expiry;
  invariant(expiry !== null, "resolveExpiryClose: operation.expiry must be set");

  const session = sessionByDate(view.calendar, expiry);
  if (!session) {
    const at = `${expiry}T00:00:00.000Z`;
    return {
      ok: false,
      error: {
        code: "insufficient_data",
        needed: {
          from: at,
          to: at,
          instruments: [operation.underlying],
          timeframes: ["D1"],
          collections: ["candles"],
        },
      },
    };
  }
  return { ok: true, session };
}
