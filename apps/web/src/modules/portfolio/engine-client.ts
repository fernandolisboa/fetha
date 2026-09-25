import { engine, type OperationPricing, type Result } from "@fetha/engine";
import type { Instant, ContemplatedLeg, RiskProfile, Ticker } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { nowInstant } from "@/lib/instant";
import { buildOperationMarketView } from "@/modules/market-data";

// The one place `apps/web` calls into `@fetha/engine`'s `priceOperation`
// for the builder: assembles the `MarketView` for the underlying and
// forwards the risk profile (or none — `priceOperation` itself notes
// `no_risk_profile` and leaves `limitBreaches` empty, which is what draws
// the "sem perfil de risco" chip).
//
// `openOperationCount` is the user's open real Operations (ADR-0021): the
// engine counts the priced proposal as one more on top of them.
export async function priceOperationLegs(
  underlying: Ticker,
  legs: ContemplatedLeg[],
  riskProfile: RiskProfile | null,
  openOperationCount: number,
  at: Instant = nowInstant(),
): Promise<Result<OperationPricing>> {
  const view = await buildOperationMarketView(getDb(), underlying, at);
  return engine.priceOperation({
    view,
    at,
    legs: legs.map((leg) => ({
      role: leg.role,
      side: leg.side,
      ticker: leg.ticker,
      quantity: leg.quantity,
    })),
    openOperationCount,
    ...(riskProfile ? { riskProfile } : {}),
  });
}
