import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decimalStringSchema, tickerSchema, type Ticker } from "@fetha/contracts";

import { getDb } from "@/db/client";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { ensureMonthlyPartition } from "@/modules/market-data/repositories/partitions";
import {
  candles,
  impliedVolatilityIndexPoints,
  optionDailyPrices,
  optionSeries,
  tradingSessions,
} from "@/modules/market-data/schema";
import { recipes } from "@/modules/strategies";

import { latestRadar } from "./radar-repository";
import { scanRadar } from "./scan";
import { radarReadings, suggestions, suggestionScores } from "./schema";
import { scoreDueSuggestions } from "./suggestion-scoring";

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

// A far-future range of its own (2095–2099), so no other fixture's sessions interleave with
// the liquidity window the universe counts over.
const SESSIONS = businessDays(`${String(2095 + Math.floor(Math.random() * 5))}-02-01`, 140);
const SCAN_INDEX = 90;
const SCAN_SESSION = SESSIONS[SCAN_INDEX] ?? "";
const EXPIRY_INDEX = 125;
const FIRST_PRICED_INDEX = 55;
const STRIKE_STEP = 0.25;

const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 3).toUpperCase();
const ticker = (prefix: string): Ticker => tickerSchema.parse(`${prefix}${suffix}3`);

type Scenario = {
  ticker: Ticker;
  close: (index: number) => number;
  iv: (index: number) => number;
  optionsTradeOn: (index: number) => boolean;
  ivPointOn: (index: number) => boolean;
};

// An up trend with a short oscillation keeps RSI(14) off its extremes; after the scanned
// session it crashes and IV spikes, which a scan reading past its close would see.
const UP_LOW_IV: Scenario = {
  ticker: ticker("ZRU"),
  close: (index) =>
    index <= SCAN_INDEX
      ? 10 * (1 + 0.0015 * index) + 0.15 * Math.sin(index * 0.9)
      : 5 + 0.01 * index,
  iv: (index) => (index <= SCAN_INDEX ? 0.5 - 0.002 * index : 0.9),
  optionsTradeOn: () => true,
  ivPointOn: () => true,
};
const DOWN_HIGH_IV: Scenario = {
  ticker: ticker("ZRD"),
  close: (index) => 10 * (1 - 0.0015 * index) + 0.15 * Math.sin(index * 0.9),
  iv: (index) => 0.2 + 0.002 * index,
  optionsTradeOn: () => true,
  ivPointOn: () => true,
};
const ILLIQUID: Scenario = {
  ...UP_LOW_IV,
  ticker: ticker("ZRI"),
  optionsTradeOn: (index) => index % 7 === 0,
};
const NO_IV_TONIGHT: Scenario = {
  ...UP_LOW_IV,
  ticker: ticker("ZRN"),
  ivPointOn: (index) => index !== SCAN_INDEX,
};
// The liquidity rule's edges: 17 traded sessions of the 21 ending at the scanned one (itself
// included) is in; 16 plus one just before the window is out.
const LIQUID_AT_EDGE: Scenario = {
  ...UP_LOW_IV,
  ticker: ticker("ZRE"),
  optionsTradeOn: (index) => index >= SCAN_INDEX - 16 && index <= SCAN_INDEX,
};
const ILLIQUID_AT_EDGE: Scenario = {
  ...UP_LOW_IV,
  ticker: ticker("ZRF"),
  optionsTradeOn: (index) =>
    index === SCAN_INDEX - 21 || (index >= SCAN_INDEX - 15 && index <= SCAN_INDEX),
};
const SCENARIOS = [
  UP_LOW_IV,
  DOWN_HIGH_IV,
  ILLIQUID,
  NO_IV_TONIGHT,
  LIQUID_AT_EDGE,
  ILLIQUID_AT_EDGE,
];
const underlyings = SCENARIOS.map((scenario) => scenario.ticker);
const optionTickers: string[] = [];
const insertedSessions: string[] = [];

function money(value: number): string {
  return value.toFixed(2);
}

function closeOf(scenario: Scenario, index: number): string {
  return money(scenario.close(index));
}

function strikes(scenario: Scenario): number[] {
  const closes = SESSIONS.map((_session, index) => scenario.close(index)).slice(
    FIRST_PRICED_INDEX,
    SCAN_INDEX + 1,
  );
  const low = Math.floor((Math.min(...closes) * 0.85) / STRIKE_STEP) * STRIKE_STEP;
  const high = Math.ceil((Math.max(...closes) * 1.15) / STRIKE_STEP) * STRIKE_STEP;
  const result: number[] = [];
  for (let strike = low; strike <= high + 1e-9; strike += STRIKE_STEP) {
    result.push(Math.round(strike * 100) / 100);
  }
  return result;
}

// COTAHIST-shaped candles go through ingestion's candle writer and options are inserted directly:
// the recorded COTAHIST sample holds one session, and a recipe's entry reads 84 sessions of history.
async function seedScenario(scenario: Scenario): Promise<void> {
  const db = getDb();
  for (const [index, session] of SESSIONS.entries()) {
    const close = decimalStringSchema.parse(closeOf(scenario, index));
    await upsertDailyCandles(db, session, new Date(`${session}T20:00:00.000Z`), [
      {
        kind: "stock",
        session,
        ticker: scenario.ticker,
        open: close,
        high: close,
        low: close,
        average: close,
        close,
        trades: 100,
        tradedQuantity: 10000,
      },
    ]);
  }
  await db.insert(impliedVolatilityIndexPoints).values(
    SESSIONS.flatMap((session, index) =>
      scenario.ivPointOn(index)
        ? [
            {
              underlying: scenario.ticker,
              session,
              asOf: new Date(`${session}T20:00:00.000Z`),
              impliedVolatility: scenario.iv(index).toFixed(4),
              method: "atm_30d_variance_interpolated" as const,
            },
          ]
        : [],
    ),
  );

  const series = strikes(scenario).flatMap((strike, ordinal) =>
    (["call", "put"] as const).map((right) => ({
      ticker: `${scenario.ticker.slice(0, 6)}${right === "call" ? "C" : "P"}${String(ordinal).padStart(3, "0")}`,
      right,
      strike,
    })),
  );
  optionTickers.push(...series.map((entry) => entry.ticker));
  const expiry = SESSIONS[EXPIRY_INDEX] ?? "";
  await db.insert(optionSeries).values(
    series.map((entry) => ({
      isin: `ISIN-${entry.ticker}`,
      ticker: entry.ticker,
      underlying: scenario.ticker,
      right: entry.right,
      strike: money(entry.strike),
      expiry,
      style: "european" as const,
      asOf: new Date(`${SESSIONS[0] ?? ""}T13:00:00.000Z`),
    })),
  );

  const prices = series.flatMap((entry) =>
    SESSIONS.slice(FIRST_PRICED_INDEX, EXPIRY_INDEX + 1).map((session, offset) => {
      const index = FIRST_PRICED_INDEX + offset;
      const spot = scenario.close(index);
      const intrinsic =
        entry.right === "call"
          ? Math.max(spot - entry.strike, 0)
          : Math.max(entry.strike - spot, 0);
      const price = money(
        Math.max(intrinsic + 0.25 * Math.sqrt((EXPIRY_INDEX - index) / 21), 0.01),
      );
      return {
        ticker: entry.ticker,
        session,
        asOf: new Date(`${session}T20:00:00.000Z`),
        right: entry.right,
        strike: money(entry.strike),
        expiry,
        average: price,
        close: price,
        trades: scenario.optionsTradeOn(index) ? 10 : 0,
        tradedQuantity: scenario.optionsTradeOn(index) ? 1000 : 0,
      };
    }),
  );
  for (let start = 0; start < prices.length; start += 1000) {
    await db.insert(optionDailyPrices).values(prices.slice(start, start + 1000));
  }
}

async function clearRadar(): Promise<void> {
  await getDb().delete(radarReadings).where(inArray(radarReadings.underlying, underlyings));
}

beforeAll(async () => {
  const db = getDb();
  const inserted = await db
    .insert(tradingSessions)
    .values(
      SESSIONS.map((date) => ({
        date,
        open: new Date(`${date}T13:00:00.000Z`),
        close: new Date(`${date}T20:00:00.000Z`),
      })),
    )
    .onConflictDoNothing()
    .returning({ date: tradingSessions.date });
  insertedSessions.push(...inserted.map((row) => row.date));
  for (const month of new Set(SESSIONS.map((session) => session.slice(0, 7)))) {
    await ensureMonthlyPartition(db, "option_daily_prices", `${month}-01`);
    await ensureMonthlyPartition(db, "candles", `${month}-01`);
  }
  for (const scenario of SCENARIOS) {
    await seedScenario(scenario);
  }
}, 180_000);

afterAll(async () => {
  const db = getDb();
  await clearRadar();
  await db.delete(optionDailyPrices).where(inArray(optionDailyPrices.ticker, optionTickers));
  await db.delete(optionSeries).where(inArray(optionSeries.underlying, underlyings));
  await db
    .delete(impliedVolatilityIndexPoints)
    .where(inArray(impliedVolatilityIndexPoints.underlying, underlyings));
  await db.delete(candles).where(inArray(candles.ticker, underlyings));
  if (insertedSessions.length > 0) {
    await db.delete(tradingSessions).where(inArray(tradingSessions.date, insertedSessions));
  }
});

function recipeIds(filter: (recipe: (typeof recipes)[number]) => boolean): string[] {
  return recipes.filter(filter).map((recipe) => recipe.id);
}

describe("scanRadar (#308)", () => {
  it("reads only liquid underlyings with tonight's IV point, and matches recipes by their own rules", async () => {
    await clearRadar();

    const outcome = await scanRadar(getDb(), { session: SCAN_SESSION, ivIndexComputed: true });

    expect(outcome).toMatchObject({
      status: "ok",
      universe: 3,
      readThisRun: 3,
      pending: 0,
      errors: 0,
    });
    const radar = await latestRadar(getDb());
    expect(radar?.session).toBe(SCAN_SESSION);
    expect(radar?.readings.map((row) => row.underlying).sort()).toEqual(
      [UP_LOW_IV.ticker, DOWN_HIGH_IV.ticker, LIQUID_AT_EDGE.ticker].sort(),
    );

    const matched = (underlying: Ticker) =>
      (radar?.matches ?? [])
        .filter((match) => match.underlying === underlying)
        .map((m) => m.recipeId);
    expect(matched(UP_LOW_IV.ticker)).toEqual(
      expect.arrayContaining(["bull-call-spread-low-iv", "long-call-low-iv"]),
    );
    for (const id of recipeIds(
      (recipe) => recipe.expectedMove === "down" || recipe.ivRegime === "high",
    )) {
      expect(matched(UP_LOW_IV.ticker)).not.toContain(id);
    }
    expect(matched(DOWN_HIGH_IV.ticker)).toContain("bear-call-spread-high-iv");
    for (const id of recipeIds(
      (recipe) => recipe.expectedMove === "up" || recipe.ivRegime === "low",
    )) {
      expect(matched(DOWN_HIGH_IV.ticker)).not.toContain(id);
    }
  }, 120_000);

  it("reads the scanned close only: nothing after it reaches the facts or the legs", async () => {
    await clearRadar();
    await scanRadar(getDb(), { session: SCAN_SESSION, ivIndexComputed: true });

    const radar = await latestRadar(getDb());
    const match = radar?.matches.find(
      (entry) =>
        entry.underlying === UP_LOW_IV.ticker && entry.recipeId === "bull-call-spread-low-iv",
    );
    expect(Number(match?.facts.close)).toBeCloseTo(UP_LOW_IV.close(SCAN_INDEX), 2);

    const sma50 = match?.facts.indicators.find(
      (entry) => entry.indicator.kind === "sma" && entry.indicator.length === 50,
    );
    const expectedSma =
      SESSIONS.slice(SCAN_INDEX - 49, SCAN_INDEX + 1)
        .map((_session, offset) => Number(closeOf(UP_LOW_IV, SCAN_INDEX - 49 + offset)))
        .reduce((sum, close) => sum + close, 0) / 50;
    expect(Number(sma50?.value)).toBeCloseTo(expectedSma, 2);

    expect(match?.legs).toHaveLength(2);
    for (const leg of match?.legs ?? []) {
      expect(leg.role).toBe("call");
      expect(leg.expiry).toBe(SESSIONS[EXPIRY_INDEX]);
    }
    const [bought, sold] = match?.legs ?? [];
    expect(bought?.side).toBe("buy");
    expect(sold?.side).toBe("sell");
    expect(Number(sold?.strike)).toBeGreaterThan(Number(bought?.strike));
  }, 120_000);

  it("stops at the deadline and the next run reads what is left", async () => {
    await clearRadar();

    // The deadline passes right after the universe is seeded, before the first read.
    let clockReads = 0;
    const first = await scanRadar(getDb(), {
      session: SCAN_SESSION,
      ivIndexComputed: true,
      deadlineAt: 1,
      now: () => (clockReads++ === 0 ? 0 : 1),
    });
    expect(first).toMatchObject({ status: "pending", universe: 3, readThisRun: 0, pending: 3 });
    const seeded = await getDb()
      .select({ reading: radarReadings.reading })
      .from(radarReadings)
      .where(inArray(radarReadings.underlying, underlyings));
    expect(seeded).toHaveLength(3);
    expect(seeded.every((row) => row.reading === null)).toBe(true);
    expect((await latestRadar(getDb()))?.session).not.toBe(SCAN_SESSION);

    const second = await scanRadar(getDb(), { session: SCAN_SESSION, ivIndexComputed: true });
    expect(second).toMatchObject({ status: "ok", universe: 3, readThisRun: 3, pending: 0 });
  }, 120_000);

  it("does no work at all when the deadline has already passed", async () => {
    await clearRadar();

    const outcome = await scanRadar(getDb(), {
      session: SCAN_SESSION,
      ivIndexComputed: true,
      deadlineAt: 0,
    });

    expect(outcome).toMatchObject({ status: "pending", universe: 0, readThisRun: 0 });
    const rows = await getDb()
      .select()
      .from(radarReadings)
      .where(inArray(radarReadings.underlying, underlyings));
    expect(rows).toHaveLength(0);
  });

  it("waits for tonight's IV index before seeding the universe", async () => {
    await clearRadar();

    const outcome = await scanRadar(getDb(), { session: SCAN_SESSION, ivIndexComputed: false });

    expect(outcome).toMatchObject({ status: "pending", universe: 0, readThisRun: 0 });
    const rows = await getDb()
      .select()
      .from(radarReadings)
      .where(inArray(radarReadings.underlying, underlyings));
    expect(rows).toHaveLength(0);
  });

  it("stores each priced match as a suggestion for one standard lot, claimed at its break-even", async () => {
    await clearRadar();
    await scanRadar(getDb(), { session: SCAN_SESSION, ivIndexComputed: true });

    const [suggestion] = await bullCallSuggestion();
    expect(suggestion?.horizon).toBe(SESSIONS[EXPIRY_INDEX]);
    expect(suggestion?.asOf.toISOString()).toBe(`${SCAN_SESSION}T20:00:00.000Z`);
    expect(suggestion?.legs.map((leg) => [leg.side, leg.quantity])).toEqual([
      ["buy", 100],
      ["sell", 100],
    ]);
    const pricing = suggestion?.pricing;
    expect(pricing?.breakEvens).toHaveLength(1);
    expect(suggestion?.claim).toEqual({
      kind: "close_above",
      instrument: UP_LOW_IV.ticker,
      level: pricing?.breakEvens[0],
    });
    expect(typeof pricing?.maxLoss).toBe("number");
    expect(pricing?.netPremium).toBeLessThan(0);
  }, 120_000);

  it("scores a suggestion only once its horizon arrives, as the lot held from the scanned close", async () => {
    await clearRadar();
    await scanRadar(getDb(), { session: SCAN_SESSION, ivIndexComputed: true });
    const [suggestion] = await bullCallSuggestion();
    const scoreOf = () =>
      getDb()
        .select()
        .from(suggestionScores)
        .where(eq(suggestionScores.suggestionId, suggestion?.id ?? ""));

    await scoreDueSuggestions(getDb(), SESSIONS[EXPIRY_INDEX - 1] ?? "");
    expect(await scoreOf()).toHaveLength(0);

    await scoreDueSuggestions(getDb(), SESSIONS[EXPIRY_INDEX] ?? "");
    const [score] = await scoreOf();
    // After the scanned close the underlying crashes far below both strikes: the claim fails and
    // the spread loses its whole debit plus costs.
    expect(score?.unscorableReason).toBeNull();
    expect(score?.claimHeld).toBe(false);
    expect(score?.pnlCentavos).toBeLessThan(0);
    expect(Math.abs(score?.pnlCentavos ?? 0)).toBeGreaterThanOrEqual(
      Math.abs(suggestion?.pricing.netPremium ?? 0),
    );

    await scoreDueSuggestions(getDb(), SESSIONS[EXPIRY_INDEX] ?? "");
    expect(await scoreOf()).toHaveLength(1);
  }, 120_000);
});

function bullCallSuggestion() {
  return getDb()
    .select()
    .from(suggestions)
    .where(
      and(
        eq(suggestions.underlying, UP_LOW_IV.ticker),
        eq(suggestions.session, SCAN_SESSION),
        eq(suggestions.recipeId, "bull-call-spread-low-iv"),
      ),
    );
}
