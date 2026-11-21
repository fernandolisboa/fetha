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
import { formatDecimal } from "@/lib/format/decimal";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";
import {
  OperationsRepository,
  priceOperationNow,
  recordFillsAsOperation,
  type ContemplatedOperation,
  type RawFillInput,
  type RecordFillsAsOperationResult,
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
  | { status: "error"; error: "invalid" | "not_found" | "already_executed" | "rate_limited" };

const idSchema = z.string().min(1).max(64);

const PREFILL_RATE_LIMIT = { windowSeconds: 60, max: 60 };

// What "Executei" opens the fill dialog with (ADR-0079 addendum, ticket #381): one row per plan
// order — ticker, side and quantity straight from the saved plan's own legs, never trusted from
// the client — plus each leg's current price as a starting point for the user's own correction.
// The current price is read live (the same `priceOperationNow` the builder's own price button
// calls), not the limit price the plan was built with: a saved plan stores only its totals
// (`contemplated_operations`' net premium and max loss), never a per-leg price, so there is
// nothing from the save itself to prefill with; the user still corrects every price to what
// actually filled before saving. Formatted pt-BR (review round 2, #381): `parsePriceInput` only
// ever accepts pt-BR input, so a prefilled dot-decimal price could never itself be submitted
// unedited.
export async function planExecutionPrefillAction(
  input: unknown,
): Promise<PlanExecutionPrefillResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };

  return withAuthenticatedAction(async () => {
    const user = await requireUser();
    const db = getDb();
    try {
      await enforceAccountRateLimit(db, user.email, "plans/prefill", PREFILL_RATE_LIMIT);
    } catch (error) {
      if (error instanceof AccountRateLimitExceededError) {
        return { status: "error", error: "rate_limited" };
      }
      throw error;
    }

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
      legs: operation.legs.map((leg) => {
        const price = priceByTicker.get(leg.ticker);
        return {
          ticker: leg.ticker,
          role: leg.role,
          side: leg.side,
          quantity: leg.quantity,
          price: price ? formatDecimal(price, 2) : null,
        };
      }),
    };
  });
}

const executeFillInputSchema = z.strictObject({
  ticker: tickerSchema,
  quantity: z.coerce.number().int().positive().max(1_000_000_000),
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
        | "not_found"
        | "already_executed"
        | "rate_limited"
        | Exclude<RecordFillsAsOperationResult, { ok: true }>["reason"];
    };

const EXECUTE_RATE_LIMIT = { windowSeconds: 60, max: 20 };

// The transaction's own refusal (review round 2, #381): thrown, never returned, so a refused
// grouping or a losing double-submit's failed link both abort the transaction outright — Drizzle
// only rolls back on a thrown error, not on a returned value, so a `return` here would have left
// the fills (and, on the link race, a second operation) committed on every refusal path.
class ExecutePlanRefusedError extends Error {
  constructor(public readonly reason: Exclude<ExecutePlanResult, { status: "ok" }>["error"]) {
    super(`execute plan refused: ${reason}`);
  }
}

// "Executei" on a saved plan (ADR-0079 addendum, ticket #381): one fill per plan order, grouped
// into one real operation and linked back to the plan, all in one transaction — an executed plan
// can never execute again (`PlanRulesRepository.linkOperation`'s own refusal, not only this
// action's own upfront check, closes the race between two concurrent submits of the same plan).
export async function executePlanAction(input: unknown): Promise<ExecutePlanResult> {
  const parsed = executeInputSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid_input" };

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

    const correctionByTicker = new Map(parsed.data.fills.map((fill) => [fill.ticker, fill]));
    if (correctionByTicker.size !== operation.legs.length) {
      return { status: "error", error: "invalid_input" };
    }

    // One leg per plan order, carrying only what the plan itself fixed (ticker and side) plus
    // whatever the user corrected (quantity, price, costs) — `recordFillsAsOperation` resolves
    // each leg's real asset class and series itself, the same validation `recordFillAction` runs
    // for its own one fill (review round 2, #381: a plan's own `role` is no longer trusted for
    // this, closing the drift that once let a stock leg skip the unknown-instrument check).
    const rawFills: RawFillInput[] = [];
    for (const leg of operation.legs) {
      const correction = correctionByTicker.get(leg.ticker);
      if (!correction) return { status: "error", error: "invalid_input" };
      rawFills.push({
        ticker: leg.ticker,
        side: leg.side,
        // Editable (review round 2, #381): the user corrects a partial fill's size here, not
        // only its price; ticker and side stay the plan's own.
        quantity: correction.quantity,
        price: correction.price,
        costs: correction.costs,
      });
    }

    let operationId: string;
    try {
      operationId = await db.transaction(async (tx) => {
        const recorded = await recordFillsAsOperation(db, tx, user, session, rawFills);
        if (!recorded.ok) {
          throw new ExecutePlanRefusedError(recorded.reason);
        }
        const linked = await planRulesRepo.linkOperation(
          contemplatedOperationId,
          recorded.operationId,
          tx,
        );
        if (!linked.ok) {
          throw new ExecutePlanRefusedError("already_executed");
        }
        return recorded.operationId;
      });
    } catch (error) {
      if (error instanceof ExecutePlanRefusedError) {
        return { status: "error", error: error.reason };
      }
      throw error;
    }

    revalidatePath("/carteira");
    return { status: "ok", operationId };
  });
}
