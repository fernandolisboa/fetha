import { eq } from "drizzle-orm";
import type { DecimalString, SessionDate, Ticker } from "@fetha/contracts";

import type { Database } from "@/db/client";
import type { ScopedUser } from "@/lib/user-scoped-repository";
import { optionSeries } from "@/modules/market-data/schema";
import type { FillSide } from "@/modules/portfolio/schema";
import { planOperation } from "@/modules/portfolio/operation-plan";
import { PortfolioRepository, type PlanFromFills } from "@/modules/portfolio/portfolio-repository";
import { seriesByHolding } from "@/modules/portfolio/portfolio-service";

export interface StockFillSeed {
  side: FillSide;
  quantity: number;
  price: string;
  session: SessionDate;
  costsCentavos?: number;
}

export interface FillSeed extends StockFillSeed {
  ticker: Ticker;
  // Set for an option fill: the expiry of its series.
  expiry?: SessionDate;
}

export interface OptionSeriesSeed {
  ticker: Ticker;
  underlying: Ticker;
  right: "call" | "put";
  strike: string;
  expiry: SessionDate;
  listedOn: SessionDate;
}

// A listed option series, so the portfolio can resolve an option fill's
// right and strike. Returns a cleanup that removes it.
export async function seedOptionSeries(
  db: Database,
  series: OptionSeriesSeed,
): Promise<() => Promise<void>> {
  const isin = `ISIN-${series.ticker}-${crypto.randomUUID().slice(0, 8)}`;
  await db.insert(optionSeries).values({
    isin,
    ticker: series.ticker,
    underlying: series.underlying,
    right: series.right,
    strike: series.strike,
    expiry: series.expiry,
    style: "european",
    asOf: new Date(`${series.listedOn}T13:00:00.000Z`),
  });
  return async () => {
    await db.delete(optionSeries).where(eq(optionSeries.isin, isin));
  };
}

async function insertAndGroup(
  db: Database,
  owner: ScopedUser,
  operationId: string | null,
  fills: readonly FillSeed[],
): Promise<{ operationId: string; fillIds: string[] }> {
  const repository = new PortfolioRepository(db, owner);
  await repository.insertFills(
    fills.map((fill) => ({
      ticker: fill.ticker,
      assetClass: fill.expiry ? ("option" as const) : ("stock" as const),
      side: fill.side,
      quantity: fill.quantity,
      price: fill.price as DecimalString,
      session: fill.session,
      costsCentavos: fill.costsCentavos ?? 0,
      expiry: fill.expiry ?? null,
      source: "manual" as const,
      importKey: null,
    })),
  );
  const ledger = await repository.listFills();
  const fillIds = ledger.filter((fill) => fill.operationId === null).map((fill) => fill.id);
  const series = await seriesByHolding(db, ledger);
  const plan: PlanFromFills = (records) => {
    const planned = planOperation(records, series);
    if (!planned.ok) {
      return planned;
    }
    const { underlying, expiry, openedAt, status, closedAt } = planned.state;
    return { ok: true, state: { underlying, expiry, openedAt, status, closedAt } };
  };
  const grouped = await repository.group(operationId, fillIds, plan);
  if (!grouped.ok) {
    throw new Error(`test setup: grouping failed (${grouped.reason})`);
  }
  return { operationId: grouped.operationId, fillIds };
}

// A real-portfolio operation grouped from the given fills, the way the
// /carteira grouping action builds one, for integration tests of the
// held-operation decision origin (ADR-0022). Assumes the owner has no other
// ungrouped fill.
export function seedOperation(
  db: Database,
  owner: ScopedUser,
  fills: readonly FillSeed[],
): Promise<{ operationId: string; fillIds: string[] }> {
  return insertAndGroup(db, owner, null, fills);
}

export function seedStockOperation(
  db: Database,
  owner: ScopedUser,
  ticker: Ticker,
  fills: readonly StockFillSeed[],
): Promise<{ operationId: string; fillIds: string[] }> {
  return seedOperation(
    db,
    owner,
    fills.map((fill) => ({ ...fill, ticker })),
  );
}

// Fills added to an existing operation after it was grouped: later trades,
// or a confirmed settlement, the user records into the same operation.
export async function addFills(
  db: Database,
  owner: ScopedUser,
  operationId: string,
  fills: readonly FillSeed[],
): Promise<string[]> {
  return (await insertAndGroup(db, owner, operationId, fills)).fillIds;
}

export async function addStockFill(
  db: Database,
  owner: ScopedUser,
  operationId: string,
  ticker: Ticker,
  fill: StockFillSeed,
): Promise<string> {
  const [added] = await addFills(db, owner, operationId, [{ ...fill, ticker }]);
  if (!added) {
    throw new Error("test setup: fill was not inserted");
  }
  return added;
}
