import { cache } from "react";
import type { SessionDate, Ticker } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { nowInstant } from "@/lib/instant";
import { recordAccess } from "@/modules/audit";
import { forCurrentUser, requireUser } from "@/modules/auth";

import { PortfolioRepository } from "./portfolio-repository";
import { loadPortfolio, type PortfolioReadModel } from "./portfolio-service";
import type { OperationStatus } from "./schema";

export const getMyPortfolio = cache(async (): Promise<PortfolioReadModel> => {
  const user = await requireUser();
  await recordAccess("portfolio_read");
  return loadPortfolio(getDb(), user, nowInstant());
});

export interface OperationSummary {
  id: string;
  underlying: Ticker;
  status: OperationStatus;
  openedAt: SessionDate;
  closedAt: SessionDate | null;
}

// An operation's own row, with none of `getMyPortfolio`'s engine valuation (#382 review
// advisory): the operation page header only ever needs the underlying and status it was recorded
// with.
export const getMyOperationSummary = cache(
  async (operationId: string): Promise<OperationSummary | null> => {
    const repository = await forCurrentUser(getDb(), PortfolioRepository);
    await recordAccess("portfolio_read");
    const operations = await repository.listOperations();
    const operation = operations.find((candidate) => candidate.id === operationId);
    if (!operation) return null;
    return {
      id: operation.id,
      underlying: operation.underlying,
      status: operation.status,
      openedAt: operation.openedAt,
      closedAt: operation.closedAt,
    };
  },
);
