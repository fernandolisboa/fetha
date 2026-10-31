import type { Instant, SessionDate } from "@fetha/contracts";
import { engine, type MarketView, type Operation, type OperationPricing } from "@fetha/engine";

// A split or other factor on the underlying since the opening puts the entry prices on another
// scale than today's strikes, and the engine only rebases them inside `markToMarket`; such an
// operation gets no chart rather than a wrong one.
export function adjustedSinceOpening(
  view: Pick<MarketView, "corporateActions">,
  operation: Pick<Operation, "underlying" | "openedAt">,
  today: SessionDate,
): boolean {
  return view.corporateActions.some(
    (action) =>
      action.ticker === operation.underlying &&
      action.exDate > operation.openedAt &&
      action.exDate <= today,
  );
}

// The payoff at expiry the operation was opened for: the engine prices its legs at their entry
// prices (`LegInput.price`), so P&L, break-evens and max gain/loss read against what was paid,
// while the spot is today's.
export async function entryPayoff(
  view: MarketView,
  at: Instant,
  operation: Operation,
  today: SessionDate,
): Promise<OperationPricing | null> {
  if (adjustedSinceOpening(view, operation, today)) return null;
  const priced = await engine.priceOperation({
    view,
    at,
    legs: operation.legs.map((leg) => ({
      role: leg.role,
      side: leg.side,
      ticker: leg.ticker,
      quantity: leg.quantity,
      price: leg.entryPrice,
    })),
  });
  return priced.ok && priced.value.payoff.length > 0 ? priced.value : null;
}
