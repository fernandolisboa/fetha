import type { ContemplatedLeg } from "@fetha/contracts";
import type { OperationPricing } from "@fetha/engine";

import { getDb } from "@/db/client";
import { nowInstant } from "@/lib/instant";
import { forCurrentUser, requireUser } from "@/modules/auth";

import { priceOperationLegs } from "./engine-client";
import { countLiveOpenOperations } from "./portfolio-service";
import { RiskProfileRepository } from "./risk-profile-repository";

// The builder's pricing path minus its rate limit and form parsing, for the
// AI analysis service's re-pricing at request time (docs/adr/0057). Kept out
// of the `"use server"` actions file so it is never exposed as an endpoint.
export async function priceOperationNow(
  underlying: string,
  legs: ContemplatedLeg[],
  options?: { excludeOperationId?: string },
): Promise<OperationPricing | null> {
  const user = await requireUser();
  const riskProfiles = await forCurrentUser(getDb(), RiskProfileRepository);
  const [riskProfile, openOperationCount] = await Promise.all([
    riskProfiles.current(),
    countLiveOpenOperations(getDb(), user, nowInstant(), options?.excludeOperationId),
  ]);
  const result = await priceOperationLegs(underlying, legs, riskProfile, openOperationCount);
  return result.ok ? result.value : null;
}
