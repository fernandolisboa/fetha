"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  sessionDateSchema,
  tickerSchema,
  type ContemplatedLeg,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";

import { getDb } from "@/db/client";
import { nowInstant } from "@/lib/instant";
import { parseCentavosInput } from "@/lib/format/parse-money";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";
import {
  isMarketIndex,
  optionSeriesForFills,
  seriesKey,
  tradingSessionForDate,
} from "@/modules/market-data";
import {
  corporateActionsByUnderlying,
  OperationsRepository,
  parsePriceInput,
  planOperation,
  PortfolioRepository,
  priceOperationNow,
  seriesByHolding,
  type ContemplatedOperation,
  type FillRecord,
  type GroupRefusal,
  type NewFill,
} from "@/modules/portfolio";

import { PlanRulesRepository } from "./plan-rules-repository";

const MAX_LEGS = 8;

export interface PrefillLeg {
  ticker: Ticker;
  role: ContemplatedLeg["role"];
  side: ContemplatedLeg["side"];
  quantity: number;
  price: string | null;
}

export type PlanExecutionPrefillResult =
  | {
      status: "ok";
      underlying: Ticker;
      today: SessionDate;
      legs: PrefillLeg[];
    }
  | { status: "error"; error: "invalid" | "not_found" | "already_executed" };

const idSchema = z.string().min(1).max(64);

// What "Executei" opens the fill dialog with (ADR-0079 addendum, ticket #381): one row per plan
// order — ticker, side and quantity straight from the saved plan's own legs, never trusted from
// the client — plus each leg's current price as a starting point for the user's own correction.
// The current price is read live (the same `priceOperationNow` the builder's own price button
// calls), not the limit price the plan was built with: a saved plan stores only its totals
// (`contemplated_operations`' net premium and max loss), never a per-leg price, so there is
// nothing from the save itself to prefill with; the user still corrects every price to what
// actually filled before saving.
export async function planExecutionPrefillAction(
  input: unknown,
): Promise<PlanExecutionPrefillResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };

  return withAuthenticatedAction(async () => {
    const user = await requireUser();
    const db = getDb();

    let operation: ContemplatedOperation;
    try {
      operation = await new OperationsRepository(db, user).findMine(parsed.data);
    } catch {
      return { status: "error", error: "not_found" };
    }
    const planRules = await new PlanRulesRepository(db, user).findByOperation(parsed.data);
    if (!planRules) return { status: "error", error: "not_found" };
    if (planRules.operationId) return { status: "error", error: "already_executed" };

    const pricing = await priceOperationNow(operation.underlying, operation.legs);
    const priceByTicker = new Map(pricing?.legs.map((leg) => [leg.leg.ticker, leg.price]) ?? []);

    return {
      status: "ok",
      underlying: operation.underlying,
      today: todaySaoPauloDate(),
      legs: operation.legs.map((leg) => ({
        ticker: leg.ticker,
        role: leg.role,
        side: leg.side,
        quantity: leg.quantity,
        price: priceByTicker.get(leg.ticker) ?? null,
      })),
    };
  });
}

const executeFillInputSchema = z.strictObject({
  ticker: tickerSchema,
  price: z.string(),
  costs: z.string(),
});

const executeInputSchema = z.strictObject({
  contemplatedOperationId: idSchema,
  session: sessionDateSchema,
  fills: z.array(executeFillInputSchema).min(1).max(MAX_LEGS),
});

export type ExecutePlanResult =
  | { status: "ok"; operationId: string }
  | {
      status: "error";
      error:
        | "invalid_input"
        | "not_found"
        | "already_executed"
        | "unknown_instrument"
        | "index_stock_leg"
        | "not_a_session"
        | "rate_limited"
        | "fills_unavailable"
        | "operation_unavailable"
        | GroupRefusal;
    };

const EXECUTE_RATE_LIMIT = { windowSeconds: 60, max: 20 };

function provisionalFillRecords(newFills: readonly NewFill[]): FillRecord[] {
  return newFills.map((fill, index) => ({
    id: `provisional-${String(index)}`,
    seq: index,
    ticker: fill.ticker,
    assetClass: fill.assetClass,
    side: fill.side,
    quantity: fill.quantity,
    price: fill.price,
    session: fill.session,
    costsCentavos: fill.costsCentavos,
    source: fill.source,
    expiry: fill.expiry,
    operationId: null,
  }));
}

// "Executei" on a saved plan (ADR-0079 addendum, ticket #381): one fill per plan order, grouped
// into one real operation and linked back to the plan, all in one transaction — an executed plan
// can never execute again (`PlanRulesRepository.linkOperation`'s own refusal, not only this
// action's own upfront check, closes the race between two concurrent submits of the same plan).
export async function executePlanAction(input: unknown): Promise<ExecutePlanResult> {
  const parsed = executeInputSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid_input" };
  if (parsed.data.session > todaySaoPauloDate()) {
    return { status: "error", error: "invalid_input" };
  }

  return withAuthenticatedAction(async () => {
    const user = await requireUser();
    try {
      await enforceAccountRateLimit(getDb(), user.email, "plans/execute", EXECUTE_RATE_LIMIT);
    } catch (error) {
      if (error instanceof AccountRateLimitExceededError) {
        return { status: "error", error: "rate_limited" };
      }
      throw error;
    }

    const db = getDb();
    const { contemplatedOperationId, session } = parsed.data;

    let operation: ContemplatedOperation;
    try {
      operation = await new OperationsRepository(db, user).findMine(contemplatedOperationId);
    } catch {
      return { status: "error", error: "not_found" };
    }
    const planRulesRepo = new PlanRulesRepository(db, user);
    const planRules = await planRulesRepo.findByOperation(contemplatedOperationId);
    if (!planRules) return { status: "error", error: "not_found" };
    if (planRules.operationId) return { status: "error", error: "already_executed" };

    // A fill dated on a day the market has not opened yet (recordFillAction's own guard): it
    // would open an operation after the mark session, which the engine refuses outright.
    const tradingSession = await tradingSessionForDate(db, session);
    if (!tradingSession || new Date(tradingSession.open) > new Date(nowInstant())) {
      return { status: "error", error: "not_a_session" };
    }

    const correctionByTicker = new Map(parsed.data.fills.map((fill) => [fill.ticker, fill]));
    if (correctionByTicker.size !== operation.legs.length) {
      return { status: "error", error: "invalid_input" };
    }

    const newFills: NewFill[] = [];
    for (const leg of operation.legs) {
      const correction = correctionByTicker.get(leg.ticker);
      if (!correction) return { status: "error", error: "invalid_input" };
      const price = parsePriceInput(correction.price);
      const costs = correction.costs.trim() === "" ? 0 : parseCentavosInput(correction.costs);
      if (price === null || costs === null) {
        return { status: "error", error: "invalid_input" };
      }

      const isStockLeg = leg.role === "stock";
      const series = isStockLeg
        ? undefined
        : (await optionSeriesForFills(db, [{ ticker: leg.ticker, session }])).get(
            seriesKey(leg.ticker, session),
          );
      if (!isStockLeg && !series) {
        return { status: "error", error: "unknown_instrument" };
      }
      if (isStockLeg && isMarketIndex(leg.ticker)) {
        return { status: "error", error: "index_stock_leg" };
      }

      newFills.push({
        ticker: leg.ticker,
        assetClass: isStockLeg ? "stock" : "option",
        side: leg.side,
        quantity: leg.quantity,
        price,
        session,
        costsCentavos: costs,
        expiry: series ? sessionDateSchema.parse(series.expiry) : null,
        source: "manual",
        importKey: null,
      });
    }

    const series = await seriesByHolding(db, provisionalFillRecords(newFills));
    const corporateActions = await corporateActionsByUnderlying(db, [operation.underlying]);
    const portfolioRepo = new PortfolioRepository(db, user);

    const result = await db.transaction(async (tx) => {
      const { ids } = await portfolioRepo.insertFills(newFills, tx);
      const grouped = await portfolioRepo.group(
        null,
        ids,
        (fillRows) => {
          const plan = planOperation(fillRows, series, corporateActions);
          if (!plan.ok) return plan;
          const { underlying, expiry, openedAt, status, closedAt } = plan.state;
          return { ok: true, state: { underlying, expiry, openedAt, status, closedAt } };
        },
        tx,
      );
      if (!grouped.ok) return grouped;

      const linked = await planRulesRepo.linkOperation(
        contemplatedOperationId,
        grouped.operationId,
        tx,
      );
      if (!linked.ok) {
        return { ok: false as const, reason: "already_executed" as const };
      }
      return grouped;
    });

    if (!result.ok) {
      return { status: "error", error: result.reason };
    }

    revalidatePath("/carteira");
    return { status: "ok", operationId: result.operationId };
  });
}
