import { cache } from "react";
import type { RiskProfile } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";

import { RiskProfileRepository } from "./risk-profile-repository";

export const getCurrentRiskProfile = cache(async (): Promise<RiskProfile | null> => {
  const repository = await forCurrentUser(getDb(), RiskProfileRepository);
  return repository.current();
});
