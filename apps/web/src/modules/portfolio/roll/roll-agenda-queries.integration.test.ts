import { afterEach, describe, expect, it } from "vitest";
import { decimalStringSchema, sessionDateSchema, tickerSchema } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { user } from "@/modules/auth/schema";
import { cotahistStockRowSchema } from "@/modules/market-data/adapters/cotahist/schema";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { optionSeries, tradingSessions } from "@/modules/market-data/schema";

import { holdingKey } from "../bookkeeping";
import { planOperation, type SeriesByHolding } from "../operation-plan";
import { PortfolioRepository, type NewFill, type PlanFromFills } from "../portfolio-repository";

import { rollAgendaFor } from "./roll-agenda-queries";

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

function businessDaysFrom(startIso: string, count: number): string[] {
  const days: string[] = [];
  const cursor = new Date(`${startIso}T00:00:00.000Z`);
  while (days.length < count) {
    if (isWeekday(cursor)) days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function nthBusinessDayFrom(startIso: string, count: number): string {
  const days = businessDaysFrom(startIso, count);
  const last = days[days.length - 1];
  if (last === undefined) throw new Error("unreachable: businessDaysFrom always fills its count");
  return last;
}

function lastBusinessDayOnOrBefore(iso: string): string {
  const cursor = new Date(`${iso}T00:00:00.000Z`);
  while (!isWeekday(cursor)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return cursor.toISOString().slice(0, 10);
}

function uniqueTicker(label: string): string {
  return `Z${label}${crypto.randomUUID().replace(/-/g, "").slice(0, 3).toUpperCase()}`;
}

// A fixed, far-future calendar window (#382), never the real wall-clock `todaySaoPauloDate()`:
// `trading_sessions` is shared reference data no test ever cleans up, so anchoring on the real
// date let another test's own seeded sessions in the same near-term range inflate
// `countSessionsClosedAfter`'s count (the CI failure this file's own fixture used to produce).
// `rollAgendaFor`'s own `today` parameter is exercised directly with this fixed date instead.
const TODAY = sessionDateSchema.parse("2063-04-09");
const LATEST_SESSION = lastBusinessDayOnOrBefore(TODAY);
const OPENED_SESSION = nthBusinessDayFrom(
  new Date(new Date(`${LATEST_SESSION}T00:00:00.000Z`).getTime() - 60 * 86_400_000)
    .toISOString()
    .slice(0, 10),
  1,
);
const dayAfterToday = new Date(`${TODAY}T00:00:00.000Z`);
dayAfterToday.setUTCDate(dayAfterToday.getUTCDate() + 1);
const FUTURE_SESSIONS = businessDaysFrom(dayAfterToday.toISOString().slice(0, 10), 3);
const EXPIRY = sessionDateSchema.parse(
  nthBusinessDayFrom(dayAfterToday.toISOString().slice(0, 10), 3),
);

async function seedCalendarAndCandle(underlying: string): Promise<void> {
  const db = getDb();
  const sessionDates = [OPENED_SESSION, LATEST_SESSION, ...FUTURE_SESSIONS];
  await db
    .insert(tradingSessions)
    .values(
      sessionDates.map((date) => ({
        date,
        open: new Date(`${date}T13:00:00.000Z`),
        close: new Date(`${date}T20:00:00.000Z`),
      })),
    )
    .onConflictDoNothing();

  await upsertDailyCandles(db, LATEST_SESSION, new Date(`${LATEST_SESSION}T20:00:00.000Z`), [
    cotahistStockRowSchema.parse({
      kind: "stock",
      session: LATEST_SESSION,
      ticker: underlying,
      open: "25.000000",
      high: "25.500000",
      low: "24.500000",
      average: "25.000000",
      close: "25.000000",
      trades: 100,
      tradedQuantity: 10000,
    }),
  ]);
}

async function seedOptionSeries(underlying: string, ticker: string, strike: string): Promise<void> {
  await getDb()
    .insert(optionSeries)
    .values({
      isin: `ISIN-${ticker}`,
      ticker,
      underlying,
      right: "call",
      strike,
      expiry: EXPIRY,
      style: "european",
      asOf: new Date(`${OPENED_SESSION}T13:00:00.000Z`),
    });
}

const createdEmails: string[] = [];

afterEach(async () => {
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

async function insertUser(label: string): Promise<{ id: string }> {
  const email = `fetha-roll-agenda-${label}-${crypto.randomUUID()}@example.com`;
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
    .returning({ id: user.id });
  if (!row) {
    throw new Error("failed to insert test user");
  }
  return row;
}

function shortCallFill(ticker: string, overrides: Partial<NewFill> = {}): NewFill {
  return {
    ticker,
    assetClass: "option",
    side: "sell",
    quantity: 100,
    price: decimalStringSchema.parse("2.00"),
    session: OPENED_SESSION,
    costsCentavos: 0,
    expiry: EXPIRY,
    source: "manual",
    importKey: null,
    ...overrides,
  };
}

describe("rollAgendaFor", () => {
  it("suggests rolling an open short call, read without the engine-valued portfolio", async () => {
    const underlying = tickerSchema.parse(uniqueTicker("U"));
    const ticker = tickerSchema.parse(`${underlying}F30`);
    await seedCalendarAndCandle(underlying);
    await seedOptionSeries(underlying, ticker, "30.00000000");

    const db = getDb();
    const owner = await insertUser("happy");
    const repository = new PortfolioRepository(db, owner);
    await repository.insertFills([shortCallFill(ticker)]);
    const [opened] = await repository.listFills();
    if (!opened) throw new Error("fixture setup failed");
    const series: SeriesByHolding = new Map([
      [holdingKey(ticker, EXPIRY), { underlying, right: "call", strike: "30.00", expiry: EXPIRY }],
    ]);
    const plan: PlanFromFills = (fills) => planOperation(fills, series);
    const grouped = await repository.group(null, [opened.id], plan);
    if (!grouped.ok) throw new Error(grouped.reason);

    const items = await rollAgendaFor(db, owner, TODAY);
    expect(items).toEqual([
      expect.objectContaining({
        operationId: grouped.operationId,
        underlying,
        expiry: EXPIRY,
        sessionsToExpiry: 3,
        action: "roll",
      }),
    ]);
  });
});

describe("rollAgendaFor isolation", () => {
  it("user B's agenda never includes user A's operation", async () => {
    const underlying = tickerSchema.parse(uniqueTicker("U"));
    const ticker = tickerSchema.parse(`${underlying}F30`);
    await seedCalendarAndCandle(underlying);
    await seedOptionSeries(underlying, ticker, "30.00000000");

    const db = getDb();
    const [a, b] = await Promise.all([insertUser("iso-a"), insertUser("iso-b")]);
    const repositoryA = new PortfolioRepository(db, a);
    await repositoryA.insertFills([shortCallFill(ticker)]);
    const [opened] = await repositoryA.listFills();
    if (!opened) throw new Error("fixture setup failed");
    const series: SeriesByHolding = new Map([
      [holdingKey(ticker, EXPIRY), { underlying, right: "call", strike: "30.00", expiry: EXPIRY }],
    ]);
    const plan: PlanFromFills = (fills) => planOperation(fills, series);
    const grouped = await repositoryA.group(null, [opened.id], plan);
    if (!grouped.ok) throw new Error(grouped.reason);

    const itemsForB = await rollAgendaFor(db, b, TODAY);
    expect(itemsForB).toEqual([]);
    const itemsForA = await rollAgendaFor(db, a, TODAY);
    expect(itemsForA.length).toBeGreaterThan(0);
  });
});
