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

export type EntryPayoff =
  { kind: "priced"; pricing: OperationPricing } | { kind: "adjusted" } | { kind: "unpriced" };

export async function entryPayoff(
  view: MarketView,
  at: Instant,
  operation: Operation,
  today: SessionDate,
): Promise<EntryPayoff> {
  if (adjustedSinceOpening(view, operation, today)) return { kind: "adjusted" };
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
  return priced.ok ? { kind: "priced", pricing: priced.value } : { kind: "unpriced" };
}
