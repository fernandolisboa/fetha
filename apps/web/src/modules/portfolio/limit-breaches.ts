import { engine, type LimitBreach } from "@fetha/engine";
import type { ContemplatedLeg, Instant, Ticker } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { nowInstant } from "@/lib/instant";
import { recordAccess } from "@/modules/audit";
import { forCurrentUser, requireUser } from "@/modules/auth";
import { buildOperationMarketView } from "@/modules/market-data";

import { countLiveOpenOperations } from "./portfolio-service";
import { RiskProfileRepository } from "./risk-profile-repository";

export type LimitCheckResult =
  { kind: "no_risk_profile" } | { kind: "unpriced" } | { kind: "checked"; breaches: LimitBreach[] };

export interface LimitCheck {
  underlying: Ticker;
  legs: ContemplatedLeg[];
  at: Instant;
}

// docs/adr/0067: a suggestion's lot checked against the signed-in user's own risk profile, by
// the engine re-pricing it at the close it was priced on, one market view per underlying and
// instant since cards often share them. Never stored: it depends on the profile of the day.
export async function getMyLimitBreaches(
  checks: readonly LimitCheck[],
): Promise<LimitCheckResult[]> {
  const user = await requireUser();
  const riskProfile = await (await forCurrentUser(getDb(), RiskProfileRepository)).current();
  await recordAccess("portfolio_read");
  if (!riskProfile) return checks.map(() => ({ kind: "no_risk_profile" }));
  const openOperationCount = await countLiveOpenOperations(getDb(), user, nowInstant());

  const views = new Map<string, ReturnType<typeof buildOperationMarketView>>();
  return Promise.all(
    checks.map(async (check) => {
      const key = `${check.underlying}@${check.at}`;
      const view = views.get(key) ?? buildOperationMarketView(getDb(), check.underlying, check.at);
      views.set(key, view);
      const pricing = await engine.priceOperation({
        view: await view,
        at: check.at,
        legs: check.legs.map((leg) => ({
          role: leg.role,
          side: leg.side,
          ticker: leg.ticker,
          quantity: leg.quantity,
        })),
        openOperationCount,
        riskProfile,
      });
      return pricing.ok
        ? { kind: "checked", breaches: pricing.value.limitBreaches }
        : { kind: "unpriced" };
    }),
  );
}
