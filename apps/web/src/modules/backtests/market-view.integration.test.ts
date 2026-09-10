import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DecimalString, StrategyDefinition, Structure } from "@fetha/contracts";
import type { StrategyVersion } from "@fetha/engine";

import { getDb } from "@/db/client";
import { candles } from "@/db/schema/market-data";
import { upsertDailyCandles } from "@/modules/market-data/repositories/candle-repository";
import { upsertTradingSessions } from "@/modules/market-data/repositories/calendar-repository";

import { loadBacktestMarketView } from "./market-view";

const TICKER = "ZQWM3";

function decimalString(value: string): DecimalString {
  return value as DecimalString;
}

function businessDays(
  count: number,
  startYear: number,
  startMonth: number,
  startDay: number,
): string[] {
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(startYear, startMonth - 1, startDay));
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

// 40 sessions so an SMA(20) warmup (~20 sessions back) reaches well before
// `period.from`, the middle of the calendar below.
const SESSIONS = businessDays(40, 2024, 3, 4);
const PERIOD_FROM = SESSIONS[25] ?? "";
const PERIOD_TO = SESSIONS.at(-1) ?? "";

const STOCK_STRUCTURE: Structure = {
  id: "stock",
  name: "Compra de ação",
  expiry: "shared",
  legs: [{ role: "stock", side: "buy", ratio: 1 }],
};

function smaDefinition(): StrategyDefinition {
  return {
    name: "SMA(20) crossover",
    timeframe: "D1",
    entry: {
      kind: "compare",
      left: { kind: "price", field: "close" },
      comparator: ">",
      right: { kind: "indicator", indicator: { kind: "sma", length: 20 } },
    },
    structureId: "stock",
    strikes: [],
    sizing: { kind: "fixed_fractional", fraction: decimalString("0.2") },
    exit: [],
    adjustments: [],
  };
}

afterEach(async () => {
  const db = getDb();
  await db.delete(candles).where(eq(candles.ticker, TICKER));
});

describe("loadBacktestMarketView", () => {
  it("loads warm-up candles before period.from for an SMA(20) strategy, not just the requested period", async () => {
    const db = getDb();
    await upsertTradingSessions(
      db,
      SESSIONS.map((date) => ({
        date,
        open: `${date}T13:00:00.000Z`,
        close: `${date}T20:00:00.000Z`,
      })),
    );
    for (const session of SESSIONS) {
      const close = decimalString("10.00");
      await upsertDailyCandles(db, session, new Date(`${session}T20:00:00.000Z`), [
        {
          kind: "stock",
          session,
          ticker: TICKER,
          open: close,
          high: close,
          low: close,
          average: close,
          close,
          trades: 10,
          tradedQuantity: 1000,
        },
      ]);
    }

    const strategy: StrategyVersion = {
      id: "v1",
      definition: smaDefinition(),
      structure: STOCK_STRUCTURE,
    };

    const view = await loadBacktestMarketView(db, {
      strategy,
      universe: [TICKER],
      period: { from: PERIOD_FROM, to: PERIOD_TO },
    });

    const earliestLoadedSession = view.candles.map((c) => c.session).sort()[0];
    expect(earliestLoadedSession).toBeDefined();
    expect((earliestLoadedSession as string) < PERIOD_FROM).toBe(true);
  });
});
