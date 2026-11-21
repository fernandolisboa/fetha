import { cache } from "react";

import { getDb } from "@/db/client";
import { recordAccess } from "@/modules/audit";
import { forCurrentUser } from "@/modules/auth";

import { cashCentavos } from "../bookkeeping";
import { PortfolioRepository } from "../portfolio-repository";

import {
  aggregateRollChainByMonth,
  chainIdsFrom,
  type RollChainEntry,
  type RollChainRow,
} from "./roll-chain";

// The roll chain containing `operationId`, from any link in it (#382, ADR-0080): each closed
// link's own result is its complete fill set's net cash flow (`cashCentavos` with no declared
// capital — an operation's fills already net to its own realized round trip), grouped by the
// month it closed in. An operation still open carries no result yet, so it is left out of the
// rows but still counts toward whether a chain exists at all.
export const getMyRollChain = cache(async (operationId: string): Promise<RollChainRow[]> => {
  const repository = await forCurrentUser(getDb(), PortfolioRepository);
  await recordAccess("portfolio_read");
  const [operations, fills] = await Promise.all([
    repository.listOperations(),
    repository.listFills(),
  ]);
  const chainIds = new Set(chainIdsFrom(operations, operationId));
  const entries: RollChainEntry[] = [];
  for (const operation of operations) {
    if (!chainIds.has(operation.id) || !operation.closedAt) continue;
    const operationFills = fills.filter((fill) => fill.operationId === operation.id);
    entries.push({
      operationId: operation.id,
      month: operation.closedAt.slice(0, 7),
      resultCentavos: cashCentavos(0, operationFills),
    });
  }
  return aggregateRollChainByMonth(entries);
});

export const getMyRollChainLength = cache(async (operationId: string): Promise<number> => {
  const repository = await forCurrentUser(getDb(), PortfolioRepository);
  await recordAccess("portfolio_read");
  const operations = await repository.listOperations();
  return chainIdsFrom(operations, operationId).length;
});
