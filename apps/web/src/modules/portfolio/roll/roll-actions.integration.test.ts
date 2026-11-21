import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/modules/auth";
import type { Database } from "@/db/client";
import type { UserScopedRepository } from "@/lib/user-scoped-repository";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { cotahistStockRowSchema } from "@/modules/market-data/adapters/cotahist/schema";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { ensureMonthlyPartition } from "@/modules/market-data/repositories/partitions";
import { optionDailyPrices, optionSeries, tradingSessions } from "@/modules/market-data/schema";

let currentUser: CurrentUser | null = null;

vi.mock("@/modules/auth", async () => {
  const actual = await vi.importActual<typeof import("@/modules/auth")>("@/modules/auth");
  return {
    ...actual,
    requireUser: (): Promise<CurrentUser> => {
      if (!currentUser) return Promise.reject(new actual.UnauthenticatedError());
      return Promise.resolve(currentUser);
    },
    forCurrentUser: <T extends UserScopedRepository>(
      db: Database,
      Repository: new (db: Database, user: CurrentUser) => T,
    ): Promise<T> => {
      if (!currentUser) return Promise.reject(new actual.UnauthenticatedError());
      return Promise.resolve(new Repository(db, currentUser));
    },
  };
});

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/modules/audit", async () => {
  const actual = await vi.importActual<typeof import("@/modules/audit")>("@/modules/audit");
  return { ...actual, recordAccess: () => Promise.resolve() };
});

const { buildRollProposalAction, recordRollAction } = await import("./roll-actions");
const { recordFillAction, groupFillsAction } = await import("../portfolio-actions");
const { PortfolioRepository } = await import("../portfolio-repository");

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

function uniqueTicker(label: string): string {
  return `Z${label}${crypto.randomUUID().replace(/-/g, "").slice(0, 3).toUpperCase()}`;
}

const SESSIONS = businessDays("2026-11-16", 45);
const OPENED_SESSION = SESSIONS[0] ?? "";
const ANCHOR_SESSION = SESSIONS[2] ?? "";
// A real trading session the fixture seeds but never gives a candle to: the user's own
// execution session has to differ from the pricing session (the latest ingested candle) for
// the regression this file's own tests guard (#382) to mean anything.
const EXECUTION_SESSION = SESSIONS[3] ?? "";
const CURRENT_EXPIRY = SESSIONS[24] ?? "";
const NEXT_EXPIRY = SESSIONS[44] ?? "";
// A real trading session earlier than every session `seedMarket` seeds, so recording a roll
// against it is refused for being earlier than the source operation's own last fill, never for
// being an unseeded date (#382).
const EARLY_SESSION = businessDays("2026-11-09", 1)[0] ?? "";

interface Market {
  underlying: string;
  currentTicker: string;
  nextTicker: string;
  closedTicker: string;
}

async function seedMarket(options: { skipCurrentPrice?: boolean } = {}): Promise<Market> {
  const db = getDb();
  const underlying = uniqueTicker("U");
  const currentTicker = `${underlying}F30`;
  const nextTicker = `${underlying}G30`;
  const closedTicker = `${underlying}F32`;

  await db
    .insert(tradingSessions)
    .values(
      SESSIONS.map((date) => ({
        date,
        open: new Date(`${date}T13:00:00.000Z`),
        close: new Date(`${date}T20:00:00.000Z`),
      })),
    )
    .onConflictDoNothing();

  for (const session of SESSIONS.slice(0, 3)) {
    await upsertDailyCandles(db, session, new Date(`${session}T20:00:00.000Z`), [
      cotahistStockRowSchema.parse({
        kind: "stock",
        session,
        ticker: underlying,
        open: "30.000000",
        high: "30.500000",
        low: "29.500000",
        average: "30.000000",
        close: "30.000000",
        trades: 100,
        tradedQuantity: 10000,
      }),
    ]);
  }

  await db.insert(optionSeries).values([
    {
      isin: `ISIN-${currentTicker}`,
      ticker: currentTicker,
      underlying,
      right: "call",
      strike: "30.00000000",
      expiry: CURRENT_EXPIRY,
      style: "european",
      asOf: new Date(`${OPENED_SESSION}T13:00:00.000Z`),
    },
    {
      isin: `ISIN-${nextTicker}`,
      ticker: nextTicker,
      underlying,
      right: "call",
      strike: "30.00000000",
      expiry: NEXT_EXPIRY,
      style: "european",
      asOf: new Date(`${OPENED_SESSION}T13:00:00.000Z`),
    },
    {
      isin: `ISIN-${closedTicker}`,
      ticker: closedTicker,
      underlying,
      right: "call",
      strike: "32.00000000",
      expiry: CURRENT_EXPIRY,
      style: "european",
      asOf: new Date(`${OPENED_SESSION}T13:00:00.000Z`),
    },
  ]);

  await ensureMonthlyPartition(db, "option_daily_prices", ANCHOR_SESSION);
  await db.insert(optionDailyPrices).values([
    ...(options.skipCurrentPrice
      ? []
      : [
          {
            ticker: currentTicker,
            session: ANCHOR_SESSION,
            asOf: new Date(`${ANCHOR_SESSION}T20:00:00.000Z`),
            right: "call" as const,
            strike: "30.00000000",
            expiry: CURRENT_EXPIRY,
            average: "1.500000",
            close: "1.500000",
            trades: 10,
            tradedQuantity: 1000,
          },
        ]),
    {
      ticker: nextTicker,
      session: ANCHOR_SESSION,
      asOf: new Date(`${ANCHOR_SESSION}T20:00:00.000Z`),
      right: "call",
      strike: "30.00000000",
      expiry: NEXT_EXPIRY,
      average: "1.000000",
      close: "1.000000",
      trades: 10,
      tradedQuantity: 1000,
    },
  ]);

  return { underlying, currentTicker, nextTicker, closedTicker };
}

const createdEmails: string[] = [];

afterEach(async () => {
  currentUser = null;
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

async function signIn(label: string): Promise<CurrentUser> {
  const email = `fetha-roll-actions-${label}-${crypto.randomUUID()}@example.com`;
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
  if (!row) throw new Error("failed to insert test user");
  currentUser = row;
  return currentUser;
}

async function openShortCall(market: Market): Promise<string> {
  const recorded = await recordFillAction({
    ticker: market.currentTicker,
    side: "sell",
    quantity: 100,
    price: "2,00",
    session: OPENED_SESSION,
    costs: "",
  });
  expect(recorded).toEqual({ status: "ok" });
  const user0 = currentUser;
  if (!user0) throw new Error("fixture setup failed");
  const fill = (await new PortfolioRepository(getDb(), user0).listFills()).find(
    (candidate) => candidate.ticker === market.currentTicker,
  );
  if (!fill) throw new Error("fixture setup failed");
  const grouped = await groupFillsAction({ fillIds: [fill.id], operationId: null });
  expect(grouped.status).toBe("ok");
  const operation = (await new PortfolioRepository(getDb(), user0).listOperations()).find(
    (candidate) => candidate.underlying === market.underlying,
  );
  if (!operation) throw new Error("fixture setup failed");
  return operation.id;
}

// A ticker that traded, and fully netted to zero, earlier in the operation's own fill history
// (#382): a round trip on `closedTicker`, grouped into the same operation as the
// still-open short call.
async function addClosedTickerHistory(market: Market, operationId: string): Promise<void> {
  const user0 = currentUser;
  if (!user0) throw new Error("fixture setup failed");
  const db = getDb();
  const repository = new PortfolioRepository(db, user0);

  const opened = await recordFillAction({
    ticker: market.closedTicker,
    side: "sell",
    quantity: 100,
    price: "1,50",
    session: OPENED_SESSION,
    costs: "",
  });
  expect(opened).toEqual({ status: "ok" });
  const openFill = (await repository.listFills()).find(
    (candidate) => candidate.ticker === market.closedTicker && candidate.operationId === null,
  );
  if (!openFill) throw new Error("fixture setup failed");
  expect((await groupFillsAction({ fillIds: [openFill.id], operationId })).status).toBe("ok");

  const closed = await recordFillAction({
    ticker: market.closedTicker,
    side: "buy",
    quantity: 100,
    price: "1,00",
    session: ANCHOR_SESSION,
    costs: "",
  });
  expect(closed).toEqual({ status: "ok" });
  const closeFill = (await repository.listFills()).find(
    (candidate) => candidate.ticker === market.closedTicker && candidate.operationId === null,
  );
  if (!closeFill) throw new Error("fixture setup failed");
  expect((await groupFillsAction({ fillIds: [closeFill.id], operationId })).status).toBe("ok");
}

describe("buildRollProposalAction", () => {
  it("proposes closing the current short call and opening the next monthly expiry's nearest strike", async () => {
    const market = await seedMarket();
    await signIn("build-ok");
    const operationId = await openShortCall(market);

    const result = await buildRollProposalAction({ operationId });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.proposal.underlying).toBe(market.underlying);
    expect(result.proposal.orders).toEqual([
      expect.objectContaining({
        action: "close",
        ticker: market.currentTicker,
        side: "buy",
        quantity: 100,
        price: "1.500000",
      }),
      expect.objectContaining({
        action: "open",
        ticker: market.nextTicker,
        side: "sell",
        quantity: 100,
        price: "1.000000",
      }),
    ]);
    // Closing (buying back) the short call at its own market close costs 100 * R$ 1,50 =
    // R$ 150,00; opening the next one at its own close brings in 100 * R$ 1,00 = R$ 100,00: a
    // net debit of R$ 50,00 (#382).
    expect(result.proposal.netCreditDebitCentavos).toBe(-5000);
  });

  it("refuses as unpriceable when the held ticker has no market price", async () => {
    const market = await seedMarket({ skipCurrentPrice: true });
    await signIn("build-unpriceable");
    const operationId = await openShortCall(market);

    const result = await buildRollProposalAction({ operationId });
    expect(result).toEqual({ status: "error", error: "unpriceable" });
  });

  it("refuses an operation with no option leg", async () => {
    const market = await seedMarket();
    const owner = await signIn("no-option-legs");
    const recorded = await recordFillAction({
      ticker: market.underlying,
      side: "buy",
      quantity: 100,
      price: "30,00",
      session: OPENED_SESSION,
      costs: "",
    });
    expect(recorded).toEqual({ status: "ok" });
    const fill = (await new PortfolioRepository(getDb(), owner).listFills())[0];
    if (!fill) throw new Error("fixture setup failed");
    await groupFillsAction({ fillIds: [fill.id], operationId: null });
    const operation = (await new PortfolioRepository(getDb(), owner).listOperations())[0];
    if (!operation) throw new Error("fixture setup failed");

    const result = await buildRollProposalAction({ operationId: operation.id });
    expect(result).toEqual({ status: "error", error: "no_option_legs" });
  });

  it("refuses an operation that belongs to another user", async () => {
    const market = await seedMarket();
    await signIn("iso-a");
    const operationId = await openShortCall(market);
    await signIn("iso-b");

    const result = await buildRollProposalAction({ operationId });
    expect(result).toEqual({ status: "error", error: "not_found" });
  });
});

describe("recordRollAction", () => {
  it("closes the source operation and opens a new one linked to it", async () => {
    const market = await seedMarket();
    const owner = await signIn("record-ok");
    const operationId = await openShortCall(market);

    const proposal = await buildRollProposalAction({ operationId });
    expect(proposal.status).toBe("ok");
    if (proposal.status !== "ok") return;

    const toInput = (order: (typeof proposal.proposal.orders)[number]) => ({
      ticker: order.ticker,
      side: order.side,
      quantity: order.quantity,
      price: "1,00",
      costs: "",
    });
    const result = await recordRollAction({
      operationId,
      session: EXECUTION_SESSION,
      closingFills: proposal.proposal.orders.filter((o) => o.action === "close").map(toInput),
      openingFills: proposal.proposal.orders.filter((o) => o.action === "open").map(toInput),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const operations = await new PortfolioRepository(getDb(), owner).listOperations();
    const source = operations.find((candidate) => candidate.id === operationId);
    const created = operations.find((candidate) => candidate.id === result.newOperationId);
    expect(source).toMatchObject({ status: "closed", rolledFromOperationId: null });
    expect(created).toMatchObject({ status: "open", rolledFromOperationId: operationId });
  });

  it("stamps the roll with the user's own execution session, not the pricing session (#382)", async () => {
    const market = await seedMarket();
    const owner = await signIn("record-session");
    const operationId = await openShortCall(market);

    const proposal = await buildRollProposalAction({ operationId });
    expect(proposal.status).toBe("ok");
    if (proposal.status !== "ok") return;

    const toInput = (order: (typeof proposal.proposal.orders)[number]) => ({
      ticker: order.ticker,
      side: order.side,
      quantity: order.quantity,
      price: "1,00",
      costs: "",
    });
    const result = await recordRollAction({
      operationId,
      session: EXECUTION_SESSION,
      closingFills: proposal.proposal.orders.filter((o) => o.action === "close").map(toInput),
      openingFills: proposal.proposal.orders.filter((o) => o.action === "open").map(toInput),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(EXECUTION_SESSION).not.toBe(ANCHOR_SESSION);
    const repository = new PortfolioRepository(getDb(), owner);
    const operations = await repository.listOperations();
    const source = operations.find((candidate) => candidate.id === operationId);
    const created = operations.find((candidate) => candidate.id === result.newOperationId);
    expect(source?.closedAt).toBe(EXECUTION_SESSION);
    expect(created?.openedAt).toBe(EXECUTION_SESSION);
    const fills = await repository.listFills();
    const newFills = fills.filter((fill) => fill.operationId === result.newOperationId);
    expect(newFills.length).toBeGreaterThan(0);
    expect(newFills.every((fill) => fill.session === EXECUTION_SESSION)).toBe(true);
  });

  it("refuses an execution session earlier than the source operation's own last fill", async () => {
    const market = await seedMarket();
    await signIn("record-early-session");
    const operationId = await openShortCall(market);
    await getDb()
      .insert(tradingSessions)
      .values({
        date: EARLY_SESSION,
        open: new Date(`${EARLY_SESSION}T13:00:00.000Z`),
        close: new Date(`${EARLY_SESSION}T20:00:00.000Z`),
      })
      .onConflictDoNothing();

    const proposal = await buildRollProposalAction({ operationId });
    expect(proposal.status).toBe("ok");
    if (proposal.status !== "ok") return;

    const toInput = (order: (typeof proposal.proposal.orders)[number]) => ({
      ticker: order.ticker,
      side: order.side,
      quantity: order.quantity,
      price: "1,00",
      costs: "",
    });
    const result = await recordRollAction({
      operationId,
      session: EARLY_SESSION,
      closingFills: proposal.proposal.orders.filter((o) => o.action === "close").map(toInput),
      openingFills: proposal.proposal.orders.filter((o) => o.action === "open").map(toInput),
    });
    expect(result).toEqual({ status: "error", error: "invalid" });
  });

  it("rolls an operation whose history has a now-closed option ticker (#382)", async () => {
    const market = await seedMarket();
    const owner = await signIn("record-closed-ticker-history");
    const operationId = await openShortCall(market);
    await addClosedTickerHistory(market, operationId);

    const proposal = await buildRollProposalAction({ operationId });
    expect(proposal.status).toBe("ok");
    if (proposal.status !== "ok") return;

    const toInput = (order: (typeof proposal.proposal.orders)[number]) => ({
      ticker: order.ticker,
      side: order.side,
      quantity: order.quantity,
      price: "1,00",
      costs: "",
    });
    const result = await recordRollAction({
      operationId,
      session: EXECUTION_SESSION,
      closingFills: proposal.proposal.orders.filter((o) => o.action === "close").map(toInput),
      openingFills: proposal.proposal.orders.filter((o) => o.action === "open").map(toInput),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const operations = await new PortfolioRepository(getDb(), owner).listOperations();
    expect(operations.find((candidate) => candidate.id === operationId)?.status).toBe("closed");
    expect(operations.find((candidate) => candidate.id === result.newOperationId)?.status).toBe(
      "open",
    );
  });

  it("refuses a session that has not opened yet", async () => {
    const market = await seedMarket();
    await signIn("record-future-session");
    const operationId = await openShortCall(market);

    const proposal = await buildRollProposalAction({ operationId });
    expect(proposal.status).toBe("ok");
    if (proposal.status !== "ok") return;

    const toInput = (order: (typeof proposal.proposal.orders)[number]) => ({
      ticker: order.ticker,
      side: order.side,
      quantity: order.quantity,
      price: "1,00",
      costs: "",
    });
    const result = await recordRollAction({
      operationId,
      session: NEXT_EXPIRY,
      closingFills: proposal.proposal.orders.filter((o) => o.action === "close").map(toInput),
      openingFills: proposal.proposal.orders.filter((o) => o.action === "open").map(toInput),
    });
    expect(result).toEqual({ status: "error", error: "invalid" });
  });

  it("refuses when the client's orders no longer match the recomputed roll", async () => {
    const market = await seedMarket();
    await signIn("record-conflict");
    const operationId = await openShortCall(market);

    const proposal = await buildRollProposalAction({ operationId });
    expect(proposal.status).toBe("ok");
    if (proposal.status !== "ok") return;

    const result = await recordRollAction({
      operationId,
      session: EXECUTION_SESSION,
      closingFills: [
        { ticker: market.currentTicker, side: "buy", quantity: 999, price: "1,00", costs: "" },
      ],
      openingFills: proposal.proposal.orders
        .filter((o) => o.action === "open")
        .map((order) => ({
          ticker: order.ticker,
          side: order.side,
          quantity: order.quantity,
          price: "1,00",
          costs: "",
        })),
    });
    expect(result).toEqual({ status: "error", error: "conflict" });
  });

  it("refuses to record a roll on another user's operation", async () => {
    const market = await seedMarket();
    await signIn("record-iso-a");
    const operationId = await openShortCall(market);
    await signIn("record-iso-b");

    const result = await recordRollAction({
      operationId,
      session: EXECUTION_SESSION,
      closingFills: [
        { ticker: market.currentTicker, side: "buy", quantity: 100, price: "1,00", costs: "" },
      ],
      openingFills: [
        { ticker: market.nextTicker, side: "sell", quantity: 100, price: "1,00", costs: "" },
      ],
    });
    expect(result).toEqual({ status: "error", error: "not_found" });
  });
});
