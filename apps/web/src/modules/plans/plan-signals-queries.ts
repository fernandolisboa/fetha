import { cache } from "react";
import type { SessionDate, Ticker } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { forCurrentUser } from "@/modules/auth";
import { getMyPortfolio } from "@/modules/portfolio";

import { PlanSignalsRepository } from "./plan-signals-repository";
import type { PlanSignalKind } from "./plan-signal-rules";

export interface PlanSignalListEntry {
  id: string;
  kind: PlanSignalKind;
  operationId: string;
  underlying: Ticker;
  session: SessionDate;
  createdAt: Date;
}

// Every plan-linked alert this user's nightly run has written (ticket #381): joined to its real
// operation's own underlying through `getMyPortfolio`'s own open operations, not a raw join or a
// second repository (#381 round 2). `getMyPortfolio` returns every operation regardless of
// status, so this filters to still-open, not-pending-settlement rows itself — an operation no
// longer open or pending settlement is excluded here, so a signal `evaluatePlanSignals` has not
// cleared yet (the narrow window before its next run) is left out of this list rather than shown
// for a position the user no longer holds (#381 round 2 correctness finding).
export const getMyPlanSignals = cache(async (): Promise<PlanSignalListEntry[]> => {
  const portfolio = await getMyPortfolio();
  const signalsRepo = await forCurrentUser(getDb(), PlanSignalsRepository);
  const signals = await signalsRepo.listMine();
  const underlyingByOperation = new Map(
    portfolio.operations
      .filter((row) => row.operation.status === "open" && !row.pendingSettlement)
      .map((row) => [row.operation.id, row.operation.underlying]),
  );
  return signals.flatMap((signal) => {
    const underlying = underlyingByOperation.get(signal.operationId);
    return underlying
      ? [
          {
            id: signal.id,
            kind: signal.kind,
            operationId: signal.operationId,
            underlying,
            session: signal.session,
            createdAt: signal.createdAt,
          },
        ]
      : [];
  });
});
