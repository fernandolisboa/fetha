"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sessionDateSchema, tickerSchema, type SessionDate } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { nowInstant } from "@/lib/instant";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";
import { parseCentavosInput } from "@/lib/format/parse-money";
import { requireUser, withAuthenticatedAction } from "@/modules/auth";
import { latestCandle, optionSeriesForFills, seriesKey } from "@/modules/market-data";

import { parseNegotiationRows, type SkipReason } from "./b3-import/parse-negotiation";
import { readFirstSheet } from "./b3-import/read-xlsx";
import { planOperation } from "./operation-plan";
import { parsePriceInput } from "./parse-price";
import { PortfolioRepository, type NewFill } from "./portfolio-repository";
import { hasExpired, proposeSettlementFor, seriesByHolding } from "./portfolio-service";
import { planSettlement, type LegChoice } from "./settlement-plan";

// ADR-0021 item 7: a year of B3 trades is a few dozen kilobytes.
const MAX_IMPORT_BYTES = 1024 * 1024;

export type ImportFillsResult =
  | {
      status: "ok";
      inserted: number;
      alreadyImported: number;
      skipped: Record<SkipReason, number>;
    }
  | { status: "error"; error: "no_file" | "too_large" | "not_xlsx" | "missing_columns" }
  | { status: "error"; error: "invalid_row"; row: number };

export type PortfolioActionResult =
  | { status: "ok" }
  | {
      status: "error";
      error:
        | "invalid_input"
        | "unknown_instrument"
        | "not_found"
        | "conflict"
        | "fills_unavailable"
        | "operation_unavailable"
        | "unknown_series"
        | "mixed_underlyings"
        | "mixed_expiries"
        | "empty"
        | "no_proposal"
        | "invalid_choice";
    };

function revalidatePortfolio() {
  revalidatePath("/carteira");
}

async function optionExpiries(
  fills: readonly { ticker: string; session: SessionDate; assetClass: string }[],
): Promise<Map<string, SessionDate>> {
  const options = fills.filter((fill) => fill.assetClass === "option");
  const resolved = await optionSeriesForFills(getDb(), options);
  const expiries = new Map<string, SessionDate>();
  for (const [key, series] of resolved) {
    expiries.set(key, sessionDateSchema.parse(series.expiry));
  }
  return expiries;
}

export async function importFillsAction(formData: FormData): Promise<ImportFillsResult> {
  return withAuthenticatedAction(async () => {
    const user = await requireUser();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { status: "error" as const, error: "no_file" as const };
    }
    if (file.size > MAX_IMPORT_BYTES) {
      return { status: "error" as const, error: "too_large" as const };
    }
    const sheet = readFirstSheet(new Uint8Array(await file.arrayBuffer()));
    if (!sheet.ok) {
      return { status: "error" as const, error: "not_xlsx" as const };
    }
    const parsed = parseNegotiationRows(sheet.rows);
    if (!parsed.ok) {
      return parsed.error === "invalid_row"
        ? { status: "error" as const, error: "invalid_row" as const, row: parsed.row }
        : { status: "error" as const, error: "missing_columns" as const };
    }

    const expiries = await optionExpiries(parsed.fills);
    const newFills: NewFill[] = parsed.fills.map((fill) => ({
      ticker: fill.ticker,
      assetClass: fill.assetClass,
      side: fill.side,
      quantity: fill.quantity,
      price: fill.price,
      session: fill.session,
      costsCentavos: 0,
      expiry:
        fill.assetClass === "option"
          ? (expiries.get(seriesKey(fill.ticker, fill.session)) ?? null)
          : null,
      source: "b3_import",
      importKey: fill.importKey,
    }));
    const { inserted } = await new PortfolioRepository(getDb(), user).insertFills(newFills);
    revalidatePortfolio();
    return {
      status: "ok" as const,
      inserted,
      alreadyImported: newFills.length - inserted,
      skipped: parsed.skipped,
    };
  });
}

const recordFillInputSchema = z.strictObject({
  ticker: z.string().trim().toUpperCase().pipe(tickerSchema),
  side: z.enum(["buy", "sell"]),
  quantity: z.coerce.number().int().positive().max(1_000_000_000),
  price: z.string(),
  session: sessionDateSchema,
  costs: z.string(),
});

export async function recordFillAction(input: unknown): Promise<PortfolioActionResult> {
  const parsed = recordFillInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid_input" };
  }
  const price = parsePriceInput(parsed.data.price);
  const costs = parsed.data.costs.trim() === "" ? 0 : parseCentavosInput(parsed.data.costs);
  if (price === null || costs === null) {
    return { status: "error", error: "invalid_input" };
  }
  const { ticker, side, quantity, session } = parsed.data;
  if (session > todaySaoPauloDate()) {
    return { status: "error", error: "invalid_input" };
  }

  return withAuthenticatedAction(async () => {
    const user = await requireUser();
    const db = getDb();
    const series = (await optionSeriesForFills(db, [{ ticker, session }])).get(
      seriesKey(ticker, session),
    );
    if (!series && !(await latestCandle(db, ticker))) {
      return { status: "error" as const, error: "unknown_instrument" as const };
    }
    await new PortfolioRepository(db, user).insertFills([
      {
        ticker,
        assetClass: series ? "option" : "stock",
        side,
        quantity,
        price,
        session,
        costsCentavos: costs,
        expiry: series ? sessionDateSchema.parse(series.expiry) : null,
        source: "manual",
        importKey: null,
      },
    ]);
    revalidatePortfolio();
    return { status: "ok" as const };
  });
}

const idSchema = z.string().min(1).max(64);

export async function deleteFillAction(id: unknown): Promise<PortfolioActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return { status: "error", error: "invalid_input" };
  }
  return withAuthenticatedAction(async () => {
    const user = await requireUser();
    const result = await new PortfolioRepository(getDb(), user).deleteUnassignedFill(parsed.data);
    revalidatePortfolio();
    return result.ok
      ? { status: "ok" as const }
      : { status: "error" as const, error: result.reason };
  });
}

const groupInputSchema = z.strictObject({
  fillIds: z.array(idSchema).min(1).max(500),
  operationId: idSchema.nullable(),
});

export async function groupFillsAction(input: unknown): Promise<PortfolioActionResult> {
  const parsed = groupInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid_input" };
  }
  return withAuthenticatedAction(async () => {
    const user = await requireUser();
    const db = getDb();
    const repository = new PortfolioRepository(db, user);
    const series = await seriesByHolding(db, await repository.listFills());
    const result = await repository.group(parsed.data.operationId, parsed.data.fillIds, (fills) => {
      const plan = planOperation(fills, series);
      if (!plan.ok) {
        return plan;
      }
      const { underlying, expiry, openedAt, status, closedAt } = plan.state;
      return { ok: true, state: { underlying, expiry, openedAt, status, closedAt } };
    });
    revalidatePortfolio();
    return result.ok
      ? { status: "ok" as const }
      : { status: "error" as const, error: result.reason };
  });
}

export async function ungroupOperationAction(id: unknown): Promise<PortfolioActionResult> {
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return { status: "error", error: "invalid_input" };
  }
  return withAuthenticatedAction(async () => {
    const user = await requireUser();
    const result = await new PortfolioRepository(getDb(), user).ungroup(parsed.data);
    revalidatePortfolio();
    return result.ok
      ? { status: "ok" as const }
      : { status: "error" as const, error: result.reason };
  });
}

const settlementInputSchema = z.strictObject({
  operationId: idSchema,
  choices: z
    .array(
      z.strictObject({
        ticker: tickerSchema,
        outcome: z.enum(["exercised", "assigned", "expired_worthless"]),
        price: z.string(),
        costs: z.string(),
      }),
    )
    .max(8),
});

// The proposal is recomputed here from the stored fills, never taken from
// the client: the user's input is only each leg's outcome, price and costs.
export async function confirmSettlementAction(input: unknown): Promise<PortfolioActionResult> {
  const parsed = settlementInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", error: "invalid_input" };
  }
  const choices: LegChoice[] = [];
  for (const choice of parsed.data.choices) {
    const price = parsePriceInput(choice.price, { allowZero: true });
    const costs = choice.costs.trim() === "" ? 0 : parseCentavosInput(choice.costs);
    if (price === null || costs === null) {
      return { status: "error", error: "invalid_input" };
    }
    choices.push({ ticker: choice.ticker, outcome: choice.outcome, price, costsCentavos: costs });
  }

  return withAuthenticatedAction(async () => {
    const user = await requireUser();
    const db = getDb();
    const repository = new PortfolioRepository(db, user);
    const [fills, operations] = await Promise.all([
      repository.listFills(),
      repository.listOperations(),
    ]);
    const operation = operations.find(
      (candidate) => candidate.id === parsed.data.operationId && candidate.status === "open",
    );
    if (!operation) {
      return { status: "error" as const, error: "not_found" as const };
    }
    const operationFills = fills.filter((fill) => fill.operationId === operation.id);
    const plan = planOperation(operationFills, await seriesByHolding(db, operationFills));
    const expiry = plan.ok ? plan.state.expiry : null;
    if (!plan.ok || !expiry) {
      return { status: "error" as const, error: "no_proposal" as const };
    }
    const proposal = await proposeSettlementFor(db, operation.id, plan.state, expiry);
    if (!proposal.ok || !(await hasExpired(db, expiry, nowInstant()))) {
      return { status: "error" as const, error: "no_proposal" as const };
    }
    const settlement = planSettlement(operation.underlying, expiry, proposal.value.legs, choices);
    if (!settlement.ok) {
      return { status: "error" as const, error: settlement.reason };
    }
    const result = await repository.settle(
      operation.id,
      operationFills.map((fill) => fill.id),
      settlement.fills,
      expiry,
    );
    revalidatePortfolio();
    return result.ok
      ? { status: "ok" as const }
      : { status: "error" as const, error: result.reason };
  });
}
