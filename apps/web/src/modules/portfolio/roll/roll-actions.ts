"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sessionDateSchema, tickerSchema, type SessionDate, type Ticker } from "@fetha/contracts";
import { engine, type LegInput, type Side } from "@fetha/engine";

import { getDb } from "@/db/client";
import { nowInstant } from "@/lib/instant";
import { parseCentavosInput } from "@/lib/format/parse-money";
import {
  AccountRateLimitExceededError,
  enforceAccountRateLimit,
  requireUser,
  withAuthenticatedAction,
} from "@/modules/auth";
import { tradingSessionForDate } from "@/modules/market-data";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";

import { holdingKey } from "../bookkeeping";
import { idSchema } from "../id-schema";
import { parsePriceInput } from "../parse-price";
import { PortfolioRepository, type NewFill, type PlanFromFills } from "../portfolio-repository";
import { planOperation, type SeriesByHolding } from "../operation-plan";
import { corporateActionsByUnderlying, seriesByHolding } from "../portfolio-service";

import { buildRollProposal, type RollProposal } from "./roll-proposal";
import { resolveRoll, type RollResolveOutcome } from "./roll-resolve";

export type RollActionError =
  | "invalid"
  | "not_found"
  | "no_option_legs"
  | "no_expiry"
  | "no_data"
  | "no_next_expiry"
  | "no_traded_series"
  | "duplicate_ticker"
  | "strike_width_changed"
  | "unpriceable"
  | "conflict"
  | "not_a_session"
  | "rate_limited";

export type BuildRollProposalResult =
  | { status: "ok"; proposal: RollProposal; expiry: SessionDate }
  | { status: "error"; error: RollActionError; ticker?: Ticker };

const BUILD_RATE_LIMIT = { windowSeconds: 60, max: 60 };
const RECORD_RATE_LIMIT = { windowSeconds: 60, max: 20 };

async function withinRollRateLimit(
  email: string,
  path: "roll/build" | "roll/record",
): Promise<boolean> {
  try {
    await enforceAccountRateLimit(
      getDb(),
      email,
      path,
      path === "roll/build" ? BUILD_RATE_LIMIT : RECORD_RATE_LIMIT,
    );
    return true;
  } catch (error) {
    if (error instanceof AccountRateLimitExceededError) {
      return false;
    }
    throw error;
  }
}

// Prices the roll's two legs of pricing (ADR-0080) with the engine's own `priceOperation`, never
// a computation of this module's own (CLAUDE.md principle 1).
async function priceProposal(
  resolved: Extract<RollResolveOutcome, { ok: true }>,
): Promise<BuildRollProposalResult> {
  const closingLegs: LegInput[] = resolved.legs.map((leg) => leg.closingLeg);
  const openingLegs: LegInput[] = resolved.legs.map((leg) => leg.openingLeg);
  const [closing, opening] = await Promise.all([
    engine.priceOperation({ view: resolved.view, at: resolved.at, legs: closingLegs }),
    engine.priceOperation({ view: resolved.view, at: resolved.at, legs: openingLegs }),
  ]);
  if (!closing.ok || !opening.ok) {
    return { status: "error", error: "unpriceable" };
  }
  const proposal = buildRollProposal({
    underlying: resolved.underlying,
    closing: closing.value,
    opening: opening.value,
  });
  // A leg with no price would show a debit as a credit (or the reverse) once netted; refuse
  // outright rather than show "indisponível" (#382).
  if (proposal.orders.some((order) => order.price === null)) {
    return { status: "error", error: "unpriceable" };
  }
  return { status: "ok", proposal, expiry: resolved.expiry };
}

function toBuildError(
  resolved: Extract<RollResolveOutcome, { ok: false }>,
): BuildRollProposalResult {
  return {
    status: "error",
    error: resolved.reason,
    ...(resolved.ticker ? { ticker: resolved.ticker } : {}),
  };
}

const buildInputSchema = z.strictObject({ operationId: idSchema });

// Builds the roll proposal for one open operation (#382): leg by leg, each closing with its side
// reversed and reopening at the next monthly expiry's nearest strike (ADR-0080), priced
// by the engine only. Recomputed from scratch on every call.
export async function buildRollProposalAction(input: unknown): Promise<BuildRollProposalResult> {
  const parsed = buildInputSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };

  return withAuthenticatedAction(async () => {
    const user = await requireUser();
    if (!(await withinRollRateLimit(user.email, "roll/build"))) {
      return { status: "error" as const, error: "rate_limited" as const };
    }
    const resolved = await resolveRoll(parsed.data.operationId);
    if (!resolved.ok) {
      return toBuildError(resolved);
    }
    return priceProposal(resolved);
  });
}

const rollFillInputSchema = z.strictObject({
  ticker: tickerSchema,
  side: z.enum(["buy", "sell"]),
  quantity: z.int().positive(),
  price: z.string(),
  costs: z.string(),
});

const recordRollInputSchema = z.strictObject({
  operationId: idSchema,
  session: sessionDateSchema,
  closingFills: z.array(rollFillInputSchema).max(8),
  openingFills: z.array(rollFillInputSchema).max(8),
});

export type RecordRollResult =
  { status: "ok"; newOperationId: string } | { status: "error"; error: RollActionError };

function orderKey(order: { ticker: Ticker; side: Side; quantity: number }): string {
  return `${order.ticker}:${order.side}:${String(order.quantity)}`;
}

// Compared as a sorted multiset of ticker+side+quantity, not a ticker map: a map would collapse
// two orders on the same ticker into one (#382).
function sameOrders(
  input: readonly { ticker: Ticker; side: Side; quantity: number }[],
  expected: readonly LegInput[],
): boolean {
  if (input.length !== expected.length) return false;
  const inputKeys = input.map(orderKey).sort();
  const expectedKeys = expected.map(orderKey).sort();
  return inputKeys.every((key, index) => key === expectedKeys[index]);
}

function toNewFills(
  orders: readonly { ticker: Ticker; side: Side; quantity: number; price: string; costs: string }[],
  expiryOf: (ticker: Ticker) => SessionDate | null,
  session: SessionDate,
): { ok: true; fills: NewFill[] } | { ok: false } {
  const fills: NewFill[] = [];
  for (const order of orders) {
    const price = parsePriceInput(order.price, { allowZero: true });
    const costs = order.costs.trim() === "" ? 0 : parseCentavosInput(order.costs);
    const expiry = expiryOf(order.ticker);
    if (price === null || costs === null || expiry === null) {
      return { ok: false };
    }
    fills.push({
      ticker: order.ticker,
      assetClass: "option",
      side: order.side,
      quantity: order.quantity,
      price,
      session,
      costsCentavos: costs,
      expiry,
      source: "manual",
      importKey: null,
    });
  }
  return { ok: true, fills };
}

// Records a roll already proposed (#382): the structure (which tickers close, which open, their
// side and quantity) is recomputed here from scratch, never trusted from the client; the user's
// own input is only each order's executed price and costs (they record what they actually
// executed, CLAUDE.md "no order execution") and the session they executed it in. Refuses with
// "conflict" when the recomputed roll no longer matches the orders the client sent, the same
// guard `confirmSettlementAction` applies to a settlement proposal that moved since it was shown.
export async function recordRollAction(input: unknown): Promise<RecordRollResult> {
  const parsed = recordRollInputSchema.safeParse(input);
  if (!parsed.success) return { status: "error", error: "invalid" };
  // A roll is stamped with the session the user actually executed it in (#382),
  // never the pricing session: validated the same way `recordFillAction` validates a fill's own
  // session, so a roll can never be recorded for a session that has not opened yet.
  if (parsed.data.session > todaySaoPauloDate()) {
    return { status: "error", error: "invalid" };
  }

  return withAuthenticatedAction(async () => {
    const user = await requireUser();
    if (!(await withinRollRateLimit(user.email, "roll/record"))) {
      return { status: "error" as const, error: "rate_limited" as const };
    }

    const db = getDb();
    const executionSession = await tradingSessionForDate(db, parsed.data.session);
    if (!executionSession || new Date(executionSession.open) > new Date(nowInstant())) {
      return { status: "error" as const, error: "not_a_session" as const };
    }

    const resolved = await resolveRoll(parsed.data.operationId);
    if (!resolved.ok) {
      return { status: "error" as const, error: resolved.reason };
    }

    const expectedClosing = resolved.legs.map((leg) => leg.closingLeg);
    const expectedOpening = resolved.legs.map((leg) => leg.openingLeg);
    if (
      !sameOrders(parsed.data.closingFills, expectedClosing) ||
      !sameOrders(parsed.data.openingFills, expectedOpening)
    ) {
      return { status: "error" as const, error: "conflict" as const };
    }

    const openingExpiryByTicker = new Map(
      resolved.legs.map((leg) => [leg.openingLeg.ticker, leg.targetSeries.expiry]),
    );
    const closing = toNewFills(
      parsed.data.closingFills,
      () => resolved.expiry,
      parsed.data.session,
    );
    const opening = toNewFills(
      parsed.data.openingFills,
      (ticker) => openingExpiryByTicker.get(ticker) ?? null,
      parsed.data.session,
    );
    if (!closing.ok || !opening.ok) {
      return { status: "error" as const, error: "invalid" as const };
    }

    const repository = new PortfolioRepository(db, user);
    const operationFills = (await repository.listFills()).filter(
      (fill) => fill.operationId === resolved.operationId,
    );
    // The execution session can never be earlier than the source operation's own last fill
    // (#382): closing it before it was last touched would store `closedAt < openedAt` on the new
    // operation, or close the source before a fill that opened it further.
    const lastFillSession = operationFills.reduce<SessionDate | null>(
      (latest, fill) => (!latest || fill.session > latest ? fill.session : latest),
      null,
    );
    if (lastFillSession && parsed.data.session < lastFillSession) {
      return { status: "error" as const, error: "invalid" as const };
    }
    // The whole fill history, not only the legs rolling today: the repository replans the
    // source operation from its complete fill set, so a ticker that was closed earlier in the
    // operation's life needs its own series facts too, or the replan refuses as `unknown_series`
    // (#382).
    const historicalSeries = await seriesByHolding(db, operationFills);
    const series: SeriesByHolding = new Map([
      ...historicalSeries,
      ...resolved.legs.map(
        (leg) =>
          [
            holdingKey(leg.openingLeg.ticker, leg.targetSeries.expiry),
            {
              underlying: resolved.underlying,
              right: leg.targetSeries.right,
              strike: leg.targetSeries.strike,
              expiry: leg.targetSeries.expiry,
            },
          ] as const,
      ),
    ]);

    const corporateActions = await corporateActionsByUnderlying(db, [resolved.underlying]);
    const plan: PlanFromFills = (fills) => planOperation(fills, series, corporateActions);

    const result = await repository.roll(
      resolved.operationId,
      resolved.fillIds,
      closing.fills,
      opening.fills,
      parsed.data.session,
      plan,
    );

    if (!result.ok) {
      return {
        status: "error" as const,
        error: result.reason === "not_found" ? "not_found" : "conflict",
      };
    }
    revalidatePath("/carteira");
    return { status: "ok" as const, newOperationId: result.newOperationId };
  });
}
