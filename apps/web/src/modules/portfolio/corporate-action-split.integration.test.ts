import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { decimalStringSchema, instantSchema, tickerSchema, type Instant } from "@fetha/contracts";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { cotahistStockRowSchema } from "@/modules/market-data/adapters/cotahist/schema";
import { upsertCorporateActionFactor } from "@/modules/market-data/repositories/corporate-action-repository";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { ensureMonthlyPartition } from "@/modules/market-data/repositories/partitions";
import {
  candles,
  corporateActionFactors,
  optionDailyPrices,
  optionSeries,
  tradingSessions,
} from "@/modules/market-data/schema";

let currentUser: CurrentUser | null = null;

vi.mock("@/modules/auth", async () => {
  const actual = await vi.importActual<typeof import("@/modules/auth")>("@/modules/auth");
  return {
    ...actual,
    forCurrentUser: <T extends UserScopedRepository>(
      db: Database,
      Repository: new (db: Database, user: CurrentUser) => T,
    ): Promise<T> => {
      if (!currentUser) {
        return Promise.reject(new actual.UnauthenticatedError());
      }
      return Promise.resolve(new Repository(db, currentUser));
    },
    requireUser: (): Promise<CurrentUser> => {
      if (!currentUser) {
        return Promise.reject(new actual.UnauthenticatedError());
      }
      return Promise.resolve(currentUser);
    },
  };
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { recordFillAction, groupFillsAction } = await import("./portfolio-actions");
const { loadPortfolio } = await import("./portfolio-service");
const { PortfolioRepository } = await import("./portfolio-repository");

const createdEmails: string[] = [];
const seededUnderlyings: string[] = [];
const seededSessions: string[] = [];

afterEach(async () => {
  currentUser = null;
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
  for (const underlying of seededUnderlyings.splice(0)) {
    await db.delete(candles).where(eq(candles.ticker, underlying));
    const series = await db
      .select({ ticker: optionSeries.ticker })
      .from(optionSeries)
      .where(eq(optionSeries.underlying, underlying));
    if (series.length > 0) {
      await db.delete(optionDailyPrices).where(
        inArray(
          optionDailyPrices.ticker,
          series.map((row) => row.ticker),
        ),
      );
    }
    await db.delete(optionSeries).where(eq(optionSeries.underlying, underlying));
    await db.delete(corporateActionFactors).where(eq(corporateActionFactors.ticker, underlying));
  }
  const dates = seededSessions.splice(0);
  if (dates.length > 0) {
    await db.delete(tradingSessions).where(inArray(tradingSessions.date, dates));
  }
});

async function signIn(label: string): Promise<CurrentUser> {
  const email = `fetha-corporate-action-split-${label}-${crypto.randomUUID()}@example.com`;
  createdEmails.push(email);
  const [row] = await getDb()
    .insert(user)
    .values({
      id: crypto.randomUUID(),
      name: "Test User",
      email,
      emailVerified: true,
      termsVersion: "2026-09-09",
      termsAcceptedAt: new Date(),
    })
    .returning();
  if (!row) {
    throw new Error("failed to insert test user");
  }
  currentUser = row;
  return currentUser;
}

function businessDays(startIso: string, count: number): string[] {
  const days: string[] = [];
  const cursor = new Date(`${startIso}T00:00:00.000Z`);
  while (days.length < count) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      days.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function closeOf(session: string): Instant {
  return instantSchema.parse(`${session}T20:00:00.000Z`);
}

function newUnderlying(): string {
  return tickerSchema.parse(`Z${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}3`);
}

interface StockMarket {
  underlying: string;
  sessions: string[];
}

async function seedStockMarket(close = "30.000000"): Promise<StockMarket> {
  const db = getDb();
  const underlying = newUnderlying();
  seededUnderlyings.push(underlying);
  const sessions = businessDays("1998-03-02", 10);
  await db
    .insert(tradingSessions)
    .values(
      sessions.map((date) => ({
        date,
        open: new Date(`${date}T13:00:00.000Z`),
        close: new Date(`${date}T20:00:00.000Z`),
      })),
    )
    .onConflictDoNothing();
  seededSessions.push(...sessions);

  for (const session of sessions) {
    await upsertDailyCandles(db, session, new Date(closeOf(session)), [
      cotahistStockRowSchema.parse({
        kind: "stock",
        session,
        ticker: underlying,
        open: close,
        high: close,
        low: close,
        average: close,
        close,
        trades: 100,
        tradedQuantity: 10000,
      }),
    ]);
  }
  return { underlying, sessions };
}

interface OptionMarket extends StockMarket {
  call: string;
  expiry: string;
}

// A past cycle so settlement reads as already expired by "now"; the underlying closes at 35,
// 3 above the 32 strike, so the call stays in the money regardless of the split under test.
async function seedOptionMarket(): Promise<OptionMarket> {
  const { underlying, sessions } = await seedStockMarket();
  const db = getDb();
  const expiry = sessions[7] ?? "";
  await upsertDailyCandles(db, expiry, new Date(closeOf(expiry)), [
    cotahistStockRowSchema.parse({
      kind: "stock",
      session: expiry,
      ticker: underlying,
      open: "35.000000",
      high: "35.000000",
      low: "35.000000",
      average: "35.000000",
      close: "35.000000",
      trades: 100,
      tradedQuantity: 10000,
    }),
  ]);

  const call = `${underlying.slice(0, 4)}C320`;
  await db.insert(optionSeries).values({
    isin: `ISIN-${call}`,
    ticker: call,
    underlying,
    right: "call",
    strike: "32.00000000",
    expiry,
    style: "european",
    asOf: new Date(`${sessions[0] ?? ""}T13:00:00.000Z`),
  });
  await ensureMonthlyPartition(db, "option_daily_prices", sessions[2] ?? "");
  await db.insert(optionDailyPrices).values({
    ticker: call,
    session: sessions[2] ?? "",
    asOf: new Date(closeOf(sessions[2] ?? "")),
    right: "call",
    strike: "32.00000000",
    expiry,
    average: "1.500000",
    close: "1.500000",
    trades: 10,
    tradedQuantity: 1000,
  });
  return { underlying, call, sessions, expiry };
}

async function recordSplit(underlying: string, exDate: string, factor: string): Promise<void> {
  await upsertCorporateActionFactor(getDb(), {
    ticker: tickerSchema.parse(underlying),
    exDate: exDate,
    asOf: new Date(`${exDate}T13:00:00.000Z`),
    factor: decimalStringSchema.parse(factor),
  });
}

describe("real positions follow a split as the broker records it (#271)", () => {
  it("(a) pre-split fills only: the settlement proposal shows the post-split share count", async () => {
    const market = await seedOptionMarket();
    const owner = await signIn("pre-split-settlement");
    const tradeDay = market.sessions[2] ?? "";

    await recordFillAction({
      ticker: market.underlying,
      side: "buy",
      quantity: 100,
      price: "30,00",
      session: tradeDay,
      costs: "",
    });
    await recordFillAction({
      ticker: market.call,
      side: "sell",
      quantity: 100,
      price: "1,50",
      session: tradeDay,
      costs: "",
    });
    // A 2-for-1 split (factor 0.5) ex-dated between the trade and the expiry.
    await recordSplit(market.underlying, market.sessions[4] ?? "", "0.5");

    const fills = await new PortfolioRepository(getDb(), owner).listFills();
    const stock = fills.find((fill) => fill.ticker === market.underlying);
    const call = fills.find((fill) => fill.ticker === market.call);
    if (!stock || !call) throw new Error("fills not recorded");
    expect(await groupFillsAction({ fillIds: [stock.id, call.id], operationId: null })).toEqual({
      status: "ok",
    });

    const afterExpiry = await loadPortfolio(getDb(), owner, closeOf(market.sessions[8] ?? ""));
    const [pending] = afterExpiry.pendingSettlements;
    if (!pending?.proposal) throw new Error("expected a settlement proposal");
    const callSettlement = pending.proposal.legs.find((leg) => leg.leg.ticker === market.call);
    expect(callSettlement?.outcome).toBe("assigned");
    expect(callSettlement?.fills[0]?.quantity).toBe(200);
  });

  it("(b) a pre-split buy plus a post-split buy in one operation combine into the correct position", async () => {
    const market = await seedStockMarket();
    const owner = await signIn("mixed-split");

    await recordFillAction({
      ticker: market.underlying,
      side: "buy",
      quantity: 50,
      price: "20,00",
      session: market.sessions[0] ?? "",
      costs: "",
    });
    // Broker-recorded post-split basis: 100 shares at the halved price.
    await recordSplit(market.underlying, market.sessions[2] ?? "", "0.5");
    await recordFillAction({
      ticker: market.underlying,
      side: "buy",
      quantity: 100,
      price: "10,00",
      session: market.sessions[4] ?? "",
      costs: "",
    });

    const fills = await new PortfolioRepository(getDb(), owner).listFills();
    expect(
      await groupFillsAction({ fillIds: fills.map((fill) => fill.id), operationId: null }),
    ).toEqual({ status: "ok" });

    const loaded = await loadPortfolio(getDb(), owner, closeOf(market.sessions[6] ?? ""));
    const operationValuation = loaded.operations[0]?.valuation;
    if (!operationValuation) throw new Error("expected an operation valuation");
    expect(operationValuation.pricing.legs[0]?.leg.quantity).toBe(200);
  });

  it("(c) a hand-entered post-split position only is not double-rebased", async () => {
    const market = await seedStockMarket();
    const owner = await signIn("post-split-only");
    // The split predates every fill of this position: the broker already shows 200 shares.
    await recordSplit(market.underlying, market.sessions[0] ?? "", "0.5");
    await recordFillAction({
      ticker: market.underlying,
      side: "buy",
      quantity: 200,
      price: "10,00",
      session: market.sessions[2] ?? "",
      costs: "",
    });

    const fills = await new PortfolioRepository(getDb(), owner).listFills();
    expect(
      await groupFillsAction({ fillIds: fills.map((fill) => fill.id), operationId: null }),
    ).toEqual({ status: "ok" });

    const loaded = await loadPortfolio(getDb(), owner, closeOf(market.sessions[6] ?? ""));
    const operationValuation = loaded.operations[0]?.valuation;
    if (!operationValuation) throw new Error("expected an operation valuation");
    expect(operationValuation.pricing.legs[0]?.leg.quantity).toBe(200);
  });

  it("(d) a 1-for-7 reverse split rebases exactly, not refused by decimal.js rounding (review round 2 item 1)", async () => {
    const market = await seedStockMarket();
    const owner = await signIn("one-for-seven-split");

    await recordFillAction({
      ticker: market.underlying,
      side: "buy",
      quantity: 700,
      price: "10,00",
      session: market.sessions[0] ?? "",
      costs: "",
    });
    // A 1-for-7 reverse split (factor 7): 1/7 is a non-terminating decimal, so inverting the
    // factor before dividing (review round 2's blocking finding) lands on 700.00000000000000001
    // instead of exactly 700 and wrongly refuses the whole group.
    await recordSplit(market.underlying, market.sessions[2] ?? "", "7");
    // Broker-recorded post-split basis: 100 shares, equivalent to the first fill's 700 pre-split.
    await recordFillAction({
      ticker: market.underlying,
      side: "buy",
      quantity: 100,
      price: "70,00",
      session: market.sessions[4] ?? "",
      costs: "",
    });

    const fills = await new PortfolioRepository(getDb(), owner).listFills();
    expect(
      await groupFillsAction({ fillIds: fills.map((fill) => fill.id), operationId: null }),
    ).toEqual({ status: "ok" });

    const loaded = await loadPortfolio(getDb(), owner, closeOf(market.sessions[6] ?? ""));
    const operationValuation = loaded.operations[0]?.valuation;
    if (!operationValuation) throw new Error("expected an operation valuation");
    expect(operationValuation.pricing.legs[0]?.leg.quantity).toBe(200);
  });
});
