import { cache } from "react";

import type { Database } from "@/db/client";
import { getDb } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { recordAccess } from "@/modules/audit";
import { requireUser } from "@/modules/auth";

import { cashCentavos } from "../bookkeeping";
import { PortfolioRepository } from "../portfolio-repository";

import {
  aggregateRollChainByMonth,
  chainIdsFrom,
  type RollChainEntry,
  type RollChainRow,
} from "./roll-chain";

// The roll chain containing `operationId`, from any link in it (#382, ADR-0080): each link's own
// net is its complete fill set's net cash flow (`cashCentavos` with no declared capital), grouped
// by the month it closed in for a closed link, or by the month it opened in for the chain's
// still-open last link — whose fill set has no closing side yet, so its net is just the premium
// already received or paid opening it (#382 review advisory). Parameterized by `db`/`user` so an
// integration test can exercise it for two different users without a request context.
export async function rollChainFor(
  db: Database,
  user: ScopedUser,
  operationId: string,
): Promise<RollChainRow[]> {
  const repository = new PortfolioRepository(db, user);
  const [operations, fills] = await Promise.all([
    repository.listOperations(),
    repository.listFills(),
  ]);
  const chainIds = new Set(chainIdsFrom(operations, operationId));
  const entries: RollChainEntry[] = [];
  for (const operation of operations) {
    if (!chainIds.has(operation.id)) continue;
    const operationFills = fills.filter((fill) => fill.operationId === operation.id);
    entries.push({
      operationId: operation.id,
      month: (operation.closedAt ?? operation.openedAt).slice(0, 7),
      netCentavos: cashCentavos(0, operationFills),
    });
  }
  return aggregateRollChainByMonth(entries);
}

export const getMyRollChain = cache(async (operationId: string): Promise<RollChainRow[]> => {
  const user = await requireUser();
  await recordAccess("portfolio_read");
  return rollChainFor(getDb(), user, operationId);
});
