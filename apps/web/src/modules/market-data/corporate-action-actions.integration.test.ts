import Decimal from "decimal.js";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.REGISTRATION_MODE = "open";

let currentHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(currentHeaders) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { openVerificationLink } from "@/modules/auth/registration-test-support";
import { signUp } from "@/modules/auth/service";
import { testRequestHeaders, uniqueTestIp } from "@/modules/auth/test-support";

import { cotahistStockRowSchema } from "./adapters/cotahist/schema";
import { loadCandleSeries } from "./candle-series";
import { upsertDailyCandles } from "./repositories/candle-repository";
import {
  candles,
  corporateActionFactors,
  impliedVolatilityIndexPoints,
  optionSeries,
  optionSeriesStrikes,
  tradingSessions,
} from "./schema";

const originalOwnerEmails = process.env.OWNER_EMAILS;
const createdEmails: string[] = [];

function uniqueEmail(label: string): string {
  return `fetha-corporate-action-${label}-${crypto.randomUUID()}@example.com`;
}

function uniqueTicker(label: string): string {
  return `Z${label}${crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

// A business day far enough in the future that no real ingestion (ADR-0017)
// could ever have reached it, mirroring market-view.integration.test.ts's
// own fixtures: these tests can seed and delete their own `trading_sessions`
// rows without ever touching a real calendar entry.
function businessDaysFrom(startIso: string, count: number): string[] {
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

async function signUpAndVerify(label: string): Promise<{ email: string; sessionHeaders: Headers }> {
  const email = uniqueEmail(label);
  createdEmails.push(email);
  const outcome = await signUp(
    { name: label, email, termsAccepted: true, privacyAccepted: true },
    testRequestHeaders(uniqueTestIp()),
  );
  if (outcome.status !== "ok") {
    throw new Error(`sign-up failed for ${email}: ${outcome.status}`);
  }
  const sessionHeaders = await openVerificationLink(email);
  return { email, sessionHeaders };
}

async function seedSession(session: string): Promise<void> {
  await getDb()
    .insert(tradingSessions)
    .values({
      date: session,
      open: new Date(`${session}T13:00:00.000Z`),
      close: new Date(`${session}T20:00:00.000Z`),
    })
    .onConflictDoNothing();
}

async function cleanupTicker(ticker: string, ownSessions: string[]): Promise<void> {
  const db = getDb();
  await db.delete(candles).where(eq(candles.ticker, ticker));
  await db.delete(corporateActionFactors).where(eq(corporateActionFactors.ticker, ticker));
  await db.delete(tradingSessions).where(inArray(tradingSessions.date, ownSessions));
}

beforeEach(() => {
  currentHeaders = new Headers();
});

afterEach(async () => {
  process.env.OWNER_EMAILS = originalOwnerEmails;
  currentHeaders = new Headers();
  const db = getDb();
  for (const email of createdEmails.splice(0)) {
    await deleteTestUser(db, email);
  }
});

describe("recordCorporateActionFactorAction against real sessions", () => {
  it("is forbidden for a signed-out caller and writes nothing", async () => {
    process.env.OWNER_EMAILS = "";
    currentHeaders = new Headers();
    const { recordCorporateActionFactorAction } = await import("./corporate-action-actions");

    const result = await recordCorporateActionFactorAction({
      ticker: uniqueTicker("FBD"),
      exDate: "2099-05-12",
      sharesBefore: 1,
      sharesAfter: 2,
    });

    expect(result).toEqual({ status: "forbidden" });
  });

  it("is forbidden for a real, verified, signed-in non-owner session", async () => {
    const { sessionHeaders } = await signUpAndVerify("non-owner");
    process.env.OWNER_EMAILS = "somebody-else@example.com";
    currentHeaders = sessionHeaders;
    const { recordCorporateActionFactorAction } = await import("./corporate-action-actions");

    const result = await recordCorporateActionFactorAction({
      ticker: uniqueTicker("NOW"),
      exDate: "2099-05-12",
      sharesBefore: 1,
      sharesAfter: 2,
    });

    expect(result).toEqual({ status: "forbidden" });
  });

  it("refuses invalid input without touching isOwner's allowlist", async () => {
    const { email, sessionHeaders } = await signUpAndVerify("owner-invalid");
    process.env.OWNER_EMAILS = email;
    currentHeaders = sessionHeaders;
    const { recordCorporateActionFactorAction } = await import("./corporate-action-actions");

    const result = await recordCorporateActionFactorAction({
      ticker: "lowercase-not-a-ticker",
      exDate: "2099-05-12",
      sharesBefore: 1,
      sharesAfter: 2,
    });

    expect(result).toEqual({ status: "invalid_input" });
  });

  it("refuses an ex-date that is not a trading session in the calendar", async () => {
    const { email, sessionHeaders } = await signUpAndVerify("owner-weekend");
    process.env.OWNER_EMAILS = email;
    currentHeaders = sessionHeaders;
    const { recordCorporateActionFactorAction } = await import("./corporate-action-actions");

    const result = await recordCorporateActionFactorAction({
      ticker: uniqueTicker("WKD"),
      exDate: "2099-05-10", // a Sunday, never a trading session
      sharesBefore: 1,
      sharesAfter: 2,
    });

    expect(result).toEqual({ status: "not_a_trading_session" });
  });

  it("refuses a ticker with no stored daily candle", async () => {
    const [session] = businessDaysFrom("2099-06-01", 1);
    if (!session) throw new Error("fixture setup failed");
    await seedSession(session);
    const ticker = uniqueTicker("NDA");

    try {
      const { email, sessionHeaders } = await signUpAndVerify("owner-unknown-ticker");
      process.env.OWNER_EMAILS = email;
      currentHeaders = sessionHeaders;
      const { recordCorporateActionFactorAction } = await import("./corporate-action-actions");

      const result = await recordCorporateActionFactorAction({
        ticker,
        exDate: session,
        sharesBefore: 1,
        sharesAfter: 2,
      });

      expect(result).toEqual({ status: "unknown_ticker" });
    } finally {
      await cleanupTicker(ticker, [session]);
    }
  });

  it("stores the factor at the ex-date session's open, and re-submitting corrects it and moves recordedAt", async () => {
    const db = getDb();
    const [session] = businessDaysFrom("2099-06-08", 1);
    if (!session) throw new Error("fixture setup failed");
    await seedSession(session);
    const ticker = uniqueTicker("WRT");
    await upsertDailyCandles(db, session, new Date(`${session}T20:00:00.000Z`), [
      cotahistStockRowSchema.parse({
        kind: "stock",
        session,
        ticker,
        open: "10.00",
        high: "10.00",
        low: "10.00",
        average: "10.00",
        close: "10.00",
        trades: 1,
        tradedQuantity: 100,
      }),
    ]);

    try {
      const { email, sessionHeaders } = await signUpAndVerify("owner-write");
      process.env.OWNER_EMAILS = email;
      currentHeaders = sessionHeaders;
      const { recordCorporateActionFactorAction } = await import("./corporate-action-actions");

      const first = await recordCorporateActionFactorAction({
        ticker,
        exDate: session,
        sharesBefore: 1,
        sharesAfter: 2,
      });
      expect(first).toEqual({ status: "ok", factor: "0.50000000" });

      const [storedFirst] = await db
        .select()
        .from(corporateActionFactors)
        .where(eq(corporateActionFactors.ticker, ticker));
      expect(storedFirst?.asOf.toISOString()).toBe(`${session}T13:00:00.000Z`);
      const firstRecordedAt = storedFirst?.recordedAt;

      const second = await recordCorporateActionFactorAction({
        ticker,
        exDate: session,
        sharesBefore: 1,
        sharesAfter: 1,
      });
      expect(second).toEqual({ status: "ok", factor: "1.00000000" });

      const [storedSecond] = await db
        .select()
        .from(corporateActionFactors)
        .where(eq(corporateActionFactors.ticker, ticker));
      expect(storedSecond?.factor).toBe("1.00000000");
      expect(storedSecond?.recordedAt.getTime()).toBeGreaterThan(firstRecordedAt?.getTime() ?? 0);
    } finally {
      await cleanupTicker(ticker, [session]);
    }
  });

  it("is a true no-op on an identical resubmission: recordedAt does not move", async () => {
    const db = getDb();
    const [session] = businessDaysFrom("2099-06-15", 1);
    if (!session) throw new Error("fixture setup failed");
    await seedSession(session);
    const ticker = uniqueTicker("IDP");
    await upsertDailyCandles(db, session, new Date(`${session}T20:00:00.000Z`), [
      cotahistStockRowSchema.parse({
        kind: "stock",
        session,
        ticker,
        open: "10.00",
        high: "10.00",
        low: "10.00",
        average: "10.00",
        close: "10.00",
        trades: 1,
        tradedQuantity: 100,
      }),
    ]);

    try {
      const { email, sessionHeaders } = await signUpAndVerify("owner-idempotent");
      process.env.OWNER_EMAILS = email;
      currentHeaders = sessionHeaders;
      const { recordCorporateActionFactorAction } = await import("./corporate-action-actions");

      await recordCorporateActionFactorAction({
        ticker,
        exDate: session,
        sharesBefore: 1,
        sharesAfter: 2,
      });
      const [stored] = await db
        .select()
        .from(corporateActionFactors)
        .where(eq(corporateActionFactors.ticker, ticker));
      const firstRecordedAt = stored?.recordedAt.getTime();

      await recordCorporateActionFactorAction({
        ticker,
        exDate: session,
        sharesBefore: 1,
        sharesAfter: 2,
      });
      const [restored] = await db
        .select()
        .from(corporateActionFactors)
        .where(eq(corporateActionFactors.ticker, ticker));

      expect(restored?.recordedAt.getTime()).toBe(firstRecordedAt);
    } finally {
      await cleanupTicker(ticker, [session]);
    }
  });

  it("marks the ticker's IV index points stale when the factor changes, not on an identical resubmission (#275)", async () => {
    const db = getDb();
    const [session] = businessDaysFrom("2099-06-22", 1);
    if (!session) throw new Error("fixture setup failed");
    await seedSession(session);
    const ticker = uniqueTicker("IVS");
    const bystander = uniqueTicker("IVB");
    await upsertDailyCandles(db, session, new Date(`${session}T20:00:00.000Z`), [
      cotahistStockRowSchema.parse({
        kind: "stock",
        session,
        ticker,
        open: "10.00",
        high: "10.00",
        low: "10.00",
        average: "10.00",
        close: "10.00",
        trades: 1,
        tradedQuantity: 100,
      }),
    ]);
    await db.insert(impliedVolatilityIndexPoints).values(
      [ticker, bystander].map((underlying) => ({
        underlying,
        session,
        asOf: new Date(`${session}T20:00:00.000Z`),
        impliedVolatility: "0.30000000",
        method: "atm_30d_variance_interpolated",
      })),
    );
    const staleByUnderlying = async (): Promise<Map<string, boolean>> => {
      const rows = await db
        .select({
          underlying: impliedVolatilityIndexPoints.underlying,
          stale: impliedVolatilityIndexPoints.stale,
        })
        .from(impliedVolatilityIndexPoints)
        .where(inArray(impliedVolatilityIndexPoints.underlying, [ticker, bystander]));
      return new Map(rows.map((row) => [row.underlying, row.stale]));
    };

    try {
      const { email, sessionHeaders } = await signUpAndVerify("owner-iv-stale");
      process.env.OWNER_EMAILS = email;
      currentHeaders = sessionHeaders;
      const { recordCorporateActionFactorAction } = await import("./corporate-action-actions");
      const split = { ticker, exDate: session, sharesBefore: 1, sharesAfter: 2 };

      await recordCorporateActionFactorAction(split);
      expect(await staleByUnderlying()).toEqual(
        new Map([
          [ticker, true],
          [bystander, false],
        ]),
      );

      await db
        .update(impliedVolatilityIndexPoints)
        .set({ stale: false })
        .where(eq(impliedVolatilityIndexPoints.underlying, ticker));
      await recordCorporateActionFactorAction(split);
      expect((await staleByUnderlying()).get(ticker)).toBe(false);
    } finally {
      await db
        .delete(impliedVolatilityIndexPoints)
        .where(inArray(impliedVolatilityIndexPoints.underlying, [ticker, bystander]));
      await cleanupTicker(ticker, [session]);
    }
  });
});

describe("recordCorporateActionFactorAction bounds the underlying's strike epochs (#272)", () => {
  it("re-dates an early-dated post-split epoch to the ex-date's open, and neutralizing the factor clears it", async () => {
    const db = getDb();
    const sessions = businessDaysFrom("2099-07-06", 4);
    const [firstSession, earlySession, , exDate] = sessions;
    if (!firstSession || !earlySession || !exDate) throw new Error("fixture setup failed");
    for (const session of sessions) {
      await seedSession(session);
    }
    const ticker = uniqueTicker("BND");
    const option = `${ticker}B310`;
    await upsertDailyCandles(db, firstSession, new Date(`${firstSession}T20:00:00.000Z`), [
      cotahistStockRowSchema.parse({
        kind: "stock",
        session: firstSession,
        ticker,
        open: "10.00",
        high: "10.00",
        low: "10.00",
        average: "10.00",
        close: "10.00",
        trades: 1,
        tradedQuantity: 100,
      }),
    ]);
    await db.insert(optionSeries).values({
      isin: `ISIN-${option}`,
      ticker: option,
      underlying: ticker,
      right: "call",
      strike: "14.98000000",
      expiry: "2099-12-18",
      style: "european",
      asOf: new Date(`${firstSession}T13:00:00.000Z`),
    });
    await db.insert(optionSeriesStrikes).values([
      {
        ticker: option,
        expiry: "2099-12-18",
        right: "call",
        strike: "29.95000000",
        asOf: new Date(`${firstSession}T20:00:00.000Z`),
      },
      {
        ticker: option,
        expiry: "2099-12-18",
        right: "call",
        strike: "14.98000000",
        asOf: new Date(`${earlySession}T13:00:00.000Z`),
      },
    ]);

    const notBefore = async () => {
      const [row] = await db
        .select({ notBefore: optionSeriesStrikes.notBefore })
        .from(optionSeriesStrikes)
        .where(
          and(
            eq(optionSeriesStrikes.ticker, option),
            eq(optionSeriesStrikes.strike, "14.98000000"),
          ),
        );
      return row?.notBefore;
    };

    try {
      const { email, sessionHeaders } = await signUpAndVerify("owner-bound");
      process.env.OWNER_EMAILS = email;
      currentHeaders = sessionHeaders;
      const { recordCorporateActionFactorAction } = await import("./corporate-action-actions");

      await recordCorporateActionFactorAction({ ticker, exDate, sharesBefore: 1, sharesAfter: 2 });
      expect(await notBefore()).toEqual(new Date(`${exDate}T13:00:00.000Z`));

      // An identical resubmission that moves a bound still moves recordedAt (dataVersion).
      await db
        .update(optionSeriesStrikes)
        .set({ notBefore: null })
        .where(eq(optionSeriesStrikes.ticker, option));
      const recordedAt = async () => {
        const [row] = await db
          .select({ recordedAt: corporateActionFactors.recordedAt })
          .from(corporateActionFactors)
          .where(eq(corporateActionFactors.ticker, ticker));
        return row?.recordedAt.getTime() ?? 0;
      };
      const beforeResubmit = await recordedAt();
      await recordCorporateActionFactorAction({ ticker, exDate, sharesBefore: 1, sharesAfter: 2 });
      expect(await notBefore()).toEqual(new Date(`${exDate}T13:00:00.000Z`));
      expect(await recordedAt()).toBeGreaterThan(beforeResubmit);

      await recordCorporateActionFactorAction({ ticker, exDate, sharesBefore: 1, sharesAfter: 1 });
      expect(await notBefore()).toBeNull();
    } finally {
      await db.delete(optionSeriesStrikes).where(eq(optionSeriesStrikes.ticker, option));
      await db.delete(optionSeries).where(eq(optionSeries.ticker, option));
      await cleanupTicker(ticker, sessions);
    }
  });
});

describe("recordCorporateActionFactorAction, PETR4's real 2008 2-for-1 split", () => {
  const lastCumSession = "2008-04-25";
  const exDateSession = "2008-04-28";
  const ticker = uniqueTicker("PET");

  afterEach(async () => {
    await cleanupTicker(ticker, [lastCumSession, exDateSession]);
  });

  it("makes the engine's adjusted series continuous across the split while the nominal one still shows the jump", async () => {
    const db = getDb();
    await seedSession(lastCumSession);
    await seedSession(exDateSession);
    await upsertDailyCandles(db, lastCumSession, new Date(`${lastCumSession}T20:00:00.000Z`), [
      cotahistStockRowSchema.parse({
        kind: "stock",
        session: lastCumSession,
        ticker,
        open: "80.00",
        high: "82.00",
        low: "79.00",
        average: "80.50",
        close: "80.00",
        trades: 1000,
        tradedQuantity: 10000,
      }),
    ]);
    await upsertDailyCandles(db, exDateSession, new Date(`${exDateSession}T20:00:00.000Z`), [
      cotahistStockRowSchema.parse({
        kind: "stock",
        session: exDateSession,
        ticker,
        open: "40.00",
        high: "41.00",
        low: "39.50",
        average: "40.20",
        close: "40.00",
        trades: 1000,
        tradedQuantity: 20000,
      }),
    ]);

    const { email, sessionHeaders } = await signUpAndVerify("owner-petr4");
    process.env.OWNER_EMAILS = email;
    currentHeaders = sessionHeaders;
    const { recordCorporateActionFactorAction } = await import("./corporate-action-actions");

    const result = await recordCorporateActionFactorAction({
      ticker,
      exDate: exDateSession,
      sharesBefore: 1,
      sharesAfter: 2,
    });
    expect(result).toEqual({ status: "ok", factor: "0.50000000" });

    const at = new Date(`${exDateSession}T21:00:00.000Z`);
    const nominal = await loadCandleSeries(db, ticker, "nominal", at);
    const adjusted = await loadCandleSeries(db, ticker, "adjusted", at);
    expect(nominal.ok).toBe(true);
    expect(adjusted.ok).toBe(true);
    if (!nominal.ok || !adjusted.ok) return;

    const nominalBefore = nominal.value.candles.find((c) => c.session === lastCumSession);
    const nominalAfter = nominal.value.candles.find((c) => c.session === exDateSession);
    const adjustedBefore = adjusted.value.candles.find((c) => c.session === lastCumSession);
    const adjustedAfter = adjusted.value.candles.find((c) => c.session === exDateSession);

    const close = (candle: { close: string } | undefined) => new Decimal(candle?.close ?? NaN);
    expect(close(nominalBefore).eq(80)).toBe(true);
    expect(close(nominalAfter).eq(40)).toBe(true);
    expect(close(adjustedAfter).eq(40)).toBe(true);
    expect(close(adjustedBefore).eq(40)).toBe(true);
  });
});
