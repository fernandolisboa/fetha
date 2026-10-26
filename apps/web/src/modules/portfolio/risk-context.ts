import type { RiskProfile } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { nowInstant } from "@/lib/instant";
import { recordAccess } from "@/modules/audit";
import { forCurrentUser, requireUser } from "@/modules/auth";

import { countLiveOpenOperations } from "./portfolio-service";
import { RiskProfileRepository } from "./risk-profile-repository";

export interface RiskContext {
  riskProfile: RiskProfile | null;
  openOperationCount: number;
}

// What a limit check needs from the signed-in user alone: their declared risk profile (null until
// they declare one) and how many operations they hold open now. Both come from user-scoped
// repositories; the portfolio read is logged like any other.
export async function getMyRiskContext(): Promise<RiskContext> {
  const user = await requireUser();
  const riskProfile = await (await forCurrentUser(getDb(), RiskProfileRepository)).current();
  await recordAccess("portfolio_read");
  const openOperationCount = await countLiveOpenOperations(getDb(), user, nowInstant());
  return { riskProfile, openOperationCount };
}
