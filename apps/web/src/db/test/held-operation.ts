import type { DecimalString, SessionDate, Ticker } from "@fetha/contracts";

import type { Database } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import type { FillSide } from "@/modules/portfolio/schema";
import { planOperation } from "@/modules/portfolio/operation-plan";
import { PortfolioRepository, type PlanFromFills } from "@/modules/portfolio/portfolio-repository";

export interface StockFillSeed {
  side: FillSide;
  quantity: number;
  price: string;
  session: SessionDate;
  costsCentavos?: number;
}

const planStockOperation: PlanFromFills = (records) => {
  const plan = planOperation(records, new Map());
  if (!plan.ok) {
    return plan;
  }
  const { underlying, expiry, openedAt, status, closedAt } = plan.state;
  return { ok: true, state: { underlying, expiry, openedAt, status, closedAt } };
};

// A stock-only real-portfolio operation grouped from the given fills, the
// way the /carteira grouping action builds one, for integration tests of the
// held-operation decision origin (ADR-0022).
export async function seedStockOperation(
  db: Database,
  owner: ScopedUser,
  ticker: Ticker,
  fills: readonly StockFillSeed[],
): Promise<{ operationId: string; fillIds: string[] }> {
  const repository = new PortfolioRepository(db, owner);
  await repository.insertFills(
    fills.map((fill) => ({
      ticker,
      assetClass: "stock" as const,
      side: fill.side,
      quantity: fill.quantity,
      price: fill.price as DecimalString,
      session: fill.session,
      costsCentavos: fill.costsCentavos ?? 0,
      expiry: null,
      source: "manual" as const,
      importKey: null,
    })),
  );
  const fillIds = (await repository.listFills())
    .filter((fill) => fill.ticker === ticker && fill.operationId === null)
    .map((fill) => fill.id);
  const grouped = await repository.group(null, fillIds, planStockOperation);
  if (!grouped.ok) {
    throw new Error(`test setup: grouping failed (${grouped.reason})`);
  }
  return { operationId: grouped.operationId, fillIds };
}

// A fill added to an existing operation after it was grouped: a later
// trade the user records and groups into the same operation.
export async function addStockFill(
  db: Database,
  owner: ScopedUser,
  operationId: string,
  ticker: Ticker,
  fill: StockFillSeed,
): Promise<string> {
  const repository = new PortfolioRepository(db, owner);
  await repository.insertFills([
    {
      ticker,
      assetClass: "stock",
      side: fill.side,
      quantity: fill.quantity,
      price: fill.price as DecimalString,
      session: fill.session,
      costsCentavos: fill.costsCentavos ?? 0,
      expiry: null,
      source: "manual",
      importKey: null,
    },
  ]);
  const [added] = (await repository.listFills()).filter(
    (candidate) => candidate.ticker === ticker && candidate.operationId === null,
  );
  if (!added) {
    throw new Error("test setup: fill was not inserted");
  }
  const grouped = await repository.group(operationId, [added.id], planStockOperation);
  if (!grouped.ok) {
    throw new Error(`test setup: grouping failed (${grouped.reason})`);
  }
  return added.id;
}
