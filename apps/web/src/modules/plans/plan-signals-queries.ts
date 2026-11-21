import { cache } from "react";
import type { SessionDate, Ticker } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { recordAccess } from "@/modules/audit";
import { requireUser } from "@/modules/auth";
import { PortfolioRepository } from "@/modules/portfolio";

import { PlanSignalsRepository } from "./plan-signals-repository";
import type { PlanSignalKind } from "./plan-signal-rules";

export interface PlanSignalListEntry {
  id: string;
  kind: PlanSignalKind;
  underlying: Ticker;
  session: SessionDate;
  createdAt: Date;
}

// Every plan-linked alert this user's nightly run has written (ticket #381): joined to its real
// operation's own underlying through `PortfolioRepository.listOperations`, not a raw join, so
// this stays inside the already user-scoped repositories both modules expose.
export const getMyPlanSignals = cache(async (): Promise<PlanSignalListEntry[]> => {
  const user = await requireUser();
  const db = getDb();
  await recordAccess("portfolio_read");
  const [signals, operations] = await Promise.all([
    new PlanSignalsRepository(db, user).listMine(),
    new PortfolioRepository(db, user).listOperations(),
  ]);
  const underlyingByOperation = new Map(
    operations.map((operation) => [operation.id, operation.underlying]),
  );
  return signals.flatMap((signal) => {
    const underlying = underlyingByOperation.get(signal.operationId);
    return underlying
      ? [
          {
            id: signal.id,
            kind: signal.kind,
            underlying,
            session: signal.session,
            createdAt: signal.createdAt,
          },
        ]
      : [];
  });
});
