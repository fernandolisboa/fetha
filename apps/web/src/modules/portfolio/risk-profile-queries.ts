import { cache } from "react";
import type { Centavos, RiskProfile } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { recordAccess } from "@/modules/audit";
import { forCurrentUser } from "@/modules/auth";

import { RiskProfileRepository } from "./risk-profile-repository";

export const getCurrentRiskProfile = cache(async (): Promise<RiskProfile | null> => {
  const repository = await forCurrentUser(getDb(), RiskProfileRepository);
  await recordAccess("portfolio_read");
  return repository.current();
});

// The shell shows the declared capital on every page, so this read writes no access-log row: one
// per navigation would bury the portfolio reads the log exists for (docs/adr/0027, addendum).
export const getMyDeclaredCapital = cache(async (): Promise<Centavos | null> => {
  const repository = await forCurrentUser(getDb(), RiskProfileRepository);
  return (await repository.current())?.declaredCapital ?? null;
});
