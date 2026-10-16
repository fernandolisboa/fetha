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
// It is also a cosmetic shell fixture, failing soft like the market bar chips in the shell layout: a
// stored profile that no longer parses must not take down every signed-in page, Risco included.
export const getMyDeclaredCapital = cache(async (): Promise<Centavos | null> => {
  const repository = await forCurrentUser(getDb(), RiskProfileRepository);
  try {
    return (await repository.current())?.declaredCapital ?? null;
  } catch {
    console.error("shell: declared capital read failed; rail foot shows it as not declared");
    return null;
  }
});
