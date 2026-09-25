import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";
import { instantSchema, tickerSchema, type Instant } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { cotahistStockRowSchema } from "@/modules/market-data/adapters/cotahist/schema";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { ensureMonthlyPartition } from "@/modules/market-data/repositories/partitions";
import {
  candles,
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

const {
  confirmSettlementAction,
  deleteFillAction,
  groupFillsAction,
  importFillsAction,
  recordFillAction,
  ungroupOperationAction,
} = await import("./portfolio-actions");
const { countLiveOpenOperations, loadPortfolio } = await import("./portfolio-service");
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
  }
  const dates = seededSessions.splice(0);
  if (dates.length > 0) {
    await db.delete(tradingSessions).where(inArray(tradingSessions.date, dates));
  }
});

async function signIn(label: string): Promise<CurrentUser> {
  const email = `fetha-portfolio-actions-${label}-${crypto.randomUUID()}@example.com`;
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

interface Market {
  underlying: string;
  call: string;
  otherCall: string;
  sessions: string[];
  expiry: string;
}

// A past cycle (1999) so the settlement action's own "now" is after expiry,
// with the underlying closing at 35 on expiry: the 32 call is in the money.
async function seedMarket(): Promise<Market> {
  const db = getDb();
  const underlying = tickerSchema.parse(
    `Z${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}3`,
  );
  seededUnderlyings.push(underlying);
  const sessions = businessDays("1999-03-01", 10);
  const expiry = sessions[7] ?? "";
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
    const close = session === expiry ? "35.000000" : "30.000000";
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

  const call = `${underlying.slice(0, 4)}C320`;
  const otherCall = `${underlying.slice(0, 4)}C400`;
  await db.insert(optionSeries).values(
    [
      { ticker: call, strike: "32.00000000" },
      { ticker: otherCall, strike: "40.00000000" },
    ].map(({ ticker, strike }) => ({
      isin: `ISIN-${ticker}`,
      ticker,
      underlying,
      right: "call",
      strike,
      expiry,
      style: "european",
      asOf: new Date(`${sessions[0] ?? ""}T13:00:00.000Z`),
    })),
  );
  await ensureMonthlyPartition(db, "option_daily_prices", sessions[2] ?? "");
  await db.insert(optionDailyPrices).values(
    [call, otherCall].map((ticker) => ({
      ticker,
      session: sessions[2] ?? "",
      asOf: new Date(closeOf(sessions[2] ?? "")),
      right: "call",
      strike: ticker === call ? "32.00000000" : "40.00000000",
      expiry,
      average: "1.500000",
      close: "1.500000",
      trades: 10,
      tradedQuantity: 1000,
    })),
  );
  return { underlying, call, otherCall, sessions, expiry };
}

function fixtureFile(): File {
  const bytes = readFileSync(
    path.join(import.meta.dirname, "b3-import", "fixtures", "negociacao.xlsx"),
  );
  return new File([bytes], "negociacao.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("importFillsAction", () => {
  it("imports the recorded export once and reports a re-import as already imported", async () => {
    await signIn("import");
    const form = new FormData();
    form.set("file", fixtureFile());

    expect(await importFillsAction(form)).toEqual({
      status: "ok",
      inserted: 6,
      alreadyImported: 0,
      skipped: { exercise: 1, unsupported_market: 1 },
    });
    expect(await importFillsAction(form)).toMatchObject({
      status: "ok",
      inserted: 0,
      alreadyImported: 6,
    });
  });

  it("fills in an option fill's expiry on a later import once its series is listed", async () => {
    const owner = await signIn("import-repair");
    const form = new FormData();
    form.set("file", fixtureFile());
    await importFillsAction(form);
    const repository = new PortfolioRepository(getDb(), owner);
    const pending = (await repository.listFills()).find((fill) => fill.ticker === "PETRJ320");
    expect(pending?.expiry).toBeNull();

    const isin = `BRTEST${crypto.randomUUID().slice(0, 6)}`;
    await getDb()
      .insert(optionSeries)
      .values({
        isin,
        ticker: "PETRJ320",
        underlying: "PETR4",
        right: "call",
        strike: "32.00000000",
        expiry: "2026-10-16",
        style: "american",
        asOf: new Date("2026-09-01T13:00:00.000Z"),
      });
    try {
      expect(await importFillsAction(form)).toMatchObject({ status: "ok", inserted: 0 });
      const repaired = (await repository.listFills()).find((fill) => fill.ticker === "PETRJ320");
      expect(repaired?.expiry).toBe("2026-10-16");
    } finally {
      await getDb().delete(optionSeries).where(eq(optionSeries.isin, isin));
    }
  });

  it("refuses a file that is not a workbook", async () => {
    await signIn("not-xlsx");
    const form = new FormData();
    form.set("file", new File(["Data;Ativo"], "extrato.csv"));
    expect(await importFillsAction(form)).toEqual({ status: "error", error: "not_xlsx" });
  });
});

describe("the portfolio from fills to a confirmed settlement", () => {
  it("rate-limits imports per account", async () => {
    await signIn("import-rate");
    const empty = new FormData();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(await importFillsAction(empty)).toEqual({ status: "error", error: "no_file" });
    }
    expect(await importFillsAction(empty)).toEqual({ status: "error", error: "rate_limited" });
  });

  it("records, groups, marks and settles a covered call", async () => {
    const market = await seedMarket();
    const owner = await signIn("flow");
    const tradeDay = market.sessions[2] ?? "";

    expect(
      await recordFillAction({
        ticker: "zzzz9",
        side: "buy",
        quantity: 100,
        price: "10",
        session: tradeDay,
        costs: "",
      }),
    ).toEqual({ status: "error", error: "unknown_instrument" });
    expect(
      await recordFillAction({
        ticker: market.underlying,
        side: "buy",
        quantity: 100,
        price: "30,00",
        session: "1999-03-06",
        costs: "",
      }),
    ).toEqual({ status: "error", error: "not_a_session" });

    for (const input of [
      { ticker: market.underlying, side: "buy", price: "30,00", costs: "5,00" },
      { ticker: market.call, side: "sell", price: "1,50", costs: "" },
      { ticker: market.otherCall, side: "sell", price: "1,50", costs: "" },
    ]) {
      expect(await recordFillAction({ ...input, quantity: 100, session: tradeDay })).toEqual({
        status: "ok",
      });
    }

    const fills = await new PortfolioRepository(getDb(), owner).listFills();
    const stock = fills.find((fill) => fill.ticker === market.underlying);
    const call = fills.find((fill) => fill.ticker === market.call);
    const otherCall = fills.find((fill) => fill.ticker === market.otherCall);
    if (!stock || !call || !otherCall) throw new Error("fills not recorded");
    expect(call).toMatchObject({ assetClass: "option", expiry: market.expiry });

    expect(await groupFillsAction({ fillIds: [stock.id, call.id], operationId: null })).toEqual({
      status: "ok",
    });

    const beforeExpiry = await loadPortfolio(getDb(), owner, closeOf(market.sessions[4] ?? ""));
    expect(await countLiveOpenOperations(getDb(), owner, closeOf(market.sessions[4] ?? ""))).toBe(
      1,
    );
    expect(await countLiveOpenOperations(getDb(), owner, closeOf(market.sessions[8] ?? ""))).toBe(
      0,
    );
    expect(beforeExpiry.cash).toBe(-300_000 - 500 + 15_000 + 15_000);
    expect(beforeExpiry.valuation).toMatchObject({ ok: true });
    expect(beforeExpiry.positions.map((row) => row.holding.ticker).sort()).toEqual(
      [market.underlying, market.call, market.otherCall].sort(),
    );
    expect(
      beforeExpiry.positions.map((row) => [row.holding.ticker, row.valuation?.price ?? null]),
    ).toEqual(
      expect.arrayContaining([
        [market.underlying, "30.000000"],
        [market.call, "1.500000"],
      ]),
    );
    const stale = beforeExpiry.positions.find((row) => row.holding.ticker === market.call);
    expect(stale?.valuation?.stale).toEqual({ session: tradeDay });
    expect(stale?.fairValue).not.toBeNull();
    expect(beforeExpiry.operations[0]?.valuation).not.toBeNull();
    expect(beforeExpiry.pendingSettlements).toEqual([]);
    if (!beforeExpiry.valuation?.ok || !beforeExpiry.greeks) throw new Error("expected greeks");
    const engineTotals = beforeExpiry.valuation.value.totals.greeks;
    expect(Number(beforeExpiry.greeks.delta)).toBeLessThan(Number(engineTotals.delta));
    expect(Number(beforeExpiry.greeks.vega)).toBeLessThan(Number(engineTotals.vega));

    const afterExpiry = await loadPortfolio(getDb(), owner, closeOf(market.sessions[8] ?? ""));
    expect(afterExpiry.expiredHoldings.map((entry) => entry.holding.ticker)).toEqual([
      market.otherCall,
    ]);
    const [pending] = afterExpiry.pendingSettlements;
    if (!pending?.proposal) throw new Error("expected a settlement proposal");
    expect(new Map(pending.proposal.legs.map((leg) => [leg.leg.ticker, leg.outcome]))).toEqual(
      new Map([
        [market.underlying, "kept"],
        [market.call, "assigned"],
      ]),
    );

    expect(
      await confirmSettlementAction({
        operationId: pending.operation.id,
        choices: [{ ticker: market.call, outcome: "exercised", price: "32,00", costs: "" }],
      }),
    ).toEqual({ status: "error", error: "invalid_choice" });
    expect(
      await confirmSettlementAction({
        operationId: pending.operation.id,
        choices: [{ ticker: market.call, outcome: "assigned", price: "32,00", costs: "2,50" }],
      }),
    ).toEqual({ status: "ok" });
    expect(
      await confirmSettlementAction({
        operationId: pending.operation.id,
        choices: [{ ticker: market.call, outcome: "assigned", price: "32,00", costs: "" }],
      }),
    ).toEqual({ status: "error", error: "not_found" });

    const settled = await loadPortfolio(getDb(), owner, closeOf(market.sessions[9] ?? ""));
    expect(settled.operations[0]?.operation).toMatchObject({
      status: "expired",
      closedAt: market.expiry,
    });
    expect(settled.positions.map((row) => row.holding.ticker)).toEqual([]);
    expect(settled.cash).toBe(-300_000 - 500 + 15_000 + 15_000 + 320_000 - 250);

    const expired = settled.expiredHoldings[0];
    if (!expired) throw new Error("expected the ungrouped expired call");
    expect(await groupFillsAction({ fillIds: expired.fillIds, operationId: null })).toEqual({
      status: "ok",
    });
    const regrouped = await loadPortfolio(getDb(), owner, closeOf(market.sessions[9] ?? ""));
    const worthless = regrouped.pendingSettlements[0];
    if (!worthless?.proposal) throw new Error("expected a second proposal");
    expect(worthless.proposal.legs[0]?.outcome).toBe("expired_worthless");
    expect(
      await confirmSettlementAction({
        operationId: worthless.operation.id,
        choices: [
          { ticker: market.otherCall, outcome: "expired_worthless", price: "40,00", costs: "" },
        ],
      }),
    ).toEqual({ status: "ok" });
    const done = await loadPortfolio(getDb(), owner, closeOf(market.sessions[9] ?? ""));
    expect(done.expiredHoldings).toEqual([]);
    expect(done.pendingSettlements).toEqual([]);
  });

  it("refuses to group fills on different underlyings and ungroups an open operation", async () => {
    const market = await seedMarket();
    const owner = await signIn("mixed");
    const tradeDay = market.sessions[2] ?? "";
    const other = await seedMarket();
    for (const ticker of [market.underlying, other.underlying]) {
      await recordFillAction({
        ticker,
        side: "buy",
        quantity: 100,
        price: "30",
        session: tradeDay,
        costs: "",
      });
    }
    const fills = await new PortfolioRepository(getDb(), owner).listFills();
    expect(
      await groupFillsAction({ fillIds: fills.map((fill) => fill.id), operationId: null }),
    ).toEqual({ status: "error", error: "mixed_underlyings" });

    const [first] = fills;
    if (!first) throw new Error("fixture setup failed");
    expect(await groupFillsAction({ fillIds: [first.id], operationId: null })).toEqual({
      status: "ok",
    });
    expect(await deleteFillAction(first.id)).toEqual({ status: "error", error: "not_found" });
    const [operation] = await new PortfolioRepository(getDb(), owner).listOperations();
    expect(await ungroupOperationAction(operation?.id)).toEqual({ status: "ok" });
    expect(await deleteFillAction(first.id)).toEqual({ status: "ok" });
  });
});
