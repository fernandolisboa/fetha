import { cache } from "react";

import type { Database } from "@/db/client";
import { getDb } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { recordAccess } from "@/modules/audit";
import { requireUser } from "@/modules/auth";

import { cashCentavos } from "../bookkeeping";
import { PortfolioRepository, type OperationRecord } from "../portfolio-repository";

import {
  aggregateRollChainByMonth,
  chainIdsFrom,
  type RollChainEntry,
  type RollChainRow,
} from "./roll-chain";

// The month a link's own net lands in (#382): a closed link's own `closedAt`
// (the roll, or final settlement, that closed it); the chain's still-open last link has no
// `closedAt` yet, so it is the roll date that opened it — the parent's own `closedAt` — when
// `rolledFromOperationId` names one, or its first option fill's own session for a root
// operation that has never rolled. Never the operation's own `openedAt`: a covered call's stock
// leg is carried forward fill for fill on a roll (ADR-0080), so `openedAt` (the earliest fill of
// any asset class) can read as the stock's own, much older purchase date.
function monthOf(
  operation: OperationRecord,
  operationFills: readonly { assetClass: string; session: string }[],
  operationsById: ReadonlyMap<string, OperationRecord>,
): string | null {
  if (operation.closedAt) {
    return operation.closedAt.slice(0, 7);
  }
  const parent = operation.rolledFromOperationId
    ? operationsById.get(operation.rolledFromOperationId)
    : null;
  if (parent?.closedAt) {
    return parent.closedAt.slice(0, 7);
  }
  const firstOptionSession = operationFills
    .filter((fill) => fill.assetClass === "option")
    .map((fill) => fill.session)
    .sort()[0];
  return firstOptionSession ? firstOptionSession.slice(0, 7) : null;
}

// The roll chain containing `operationId`, from any link in it (#382, ADR-0080): each link's own
// net is its option fills' own net cash flow (`cashCentavos` with no declared capital) — never
// its stock leg, which a covered call carries forward untouched on every roll and which is not
// cash a roll itself moved — grouped by the month above. Parameterized by `db`/`user` so an
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
  const operationsById = new Map(operations.map((operation) => [operation.id, operation]));
  const chainIds = new Set(chainIdsFrom(operations, operationId));
  const entries: RollChainEntry[] = [];
  for (const operation of operations) {
    if (!chainIds.has(operation.id)) continue;
    const operationFills = fills.filter((fill) => fill.operationId === operation.id);
    const month = monthOf(operation, operationFills, operationsById);
    if (!month) continue;
    const optionFills = operationFills.filter((fill) => fill.assetClass === "option");
    entries.push({
      operationId: operation.id,
      month,
      netCentavos: cashCentavos(0, optionFills),
      open: operation.status === "open",
    });
  }
  return aggregateRollChainByMonth(entries);
}

export const getMyRollChain = cache(async (operationId: string): Promise<RollChainRow[]> => {
  const user = await requireUser();
  await recordAccess("portfolio_read");
  return rollChainFor(getDb(), user, operationId);
});
