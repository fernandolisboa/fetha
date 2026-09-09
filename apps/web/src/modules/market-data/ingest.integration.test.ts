import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import {
  candles,
  ingestionRuns,
  macroPoints,
  optionDailyPrices,
  optionSeries,
  tradingSessions,
} from "@/db/schema/market-data";

import { ingest } from "./ingest";

const TEST_SESSION = "2026-06-15";
const TEST_YEAR = 2026;
const STOCK_TICKER = "ZZT3";
const OPTION_TICKER = "ZZTW999";

function padRight(value: string, length: number): string {
  return value.slice(0, length).padEnd(length, " ");
}
function padLeft(value: string, length: number): string {
  return value.slice(0, length).padStart(length, "0");
}

function buildCotahistFixture(): string {
  function baseRow(tpmerc: string, ticker: string): string {
    let row = "01";
    row += TEST_SESSION.replaceAll("-", "");
    row += "02";
    row += padRight(ticker, 12);
    row += tpmerc;
    row += padRight("TESTE", 12);
    row += padRight("ON", 10);
    row += padRight("", 3);
    row += padRight("R$", 4);
    row += padLeft("100", 13);
    row += padLeft("110", 13);
    row += padLeft("90", 13);
    row += padLeft("105", 13);
    row += padLeft("108", 13);
    row += padLeft("107", 13);
    row += padLeft("109", 13);
    row += padLeft("50", 5);
    row += padLeft("1000", 18);
    row += padLeft("108000", 18);
    if (tpmerc === "070") {
      row += padLeft("500", 13);
      row += "0";
      row += "20261016";
      row += padLeft("1", 7);
    } else {
      row += padLeft("0", 13);
      row += "0";
      row += padRight("", 8);
      row += padLeft("1", 7);
    }
    row += padLeft("0", 13);
    row += padRight("BRZZZTESTE01", 12);
    row += padLeft("99", 3);
    return row;
  }

  const header = padRight(
    `00COTAHIST.2026${padRight("BOVESPA", 7)}${TEST_SESSION.replaceAll("-", "")}`,
    245,
  );
  const stock = baseRow("010", STOCK_TICKER);
  const option = baseRow("070", OPTION_TICKER);
  const trailer = padRight("9900003", 245);
  return [header, stock, option, trailer].join("\n");
}

function buildInstrumentsFixture(): string {
  return [
    "RptDt;TckrSymb;Asst;CFICode;XprtnDt;OptnStyle;ExrcPric",
    `${TEST_SESSION};${OPTION_TICKER};ZZT;OCASPS;2026-10-16;A;5.00`,
  ].join("\n");
}

function buildSgsFixture(url: string): string {
  const params = new URL(url).searchParams;
  const finalDate = params.get("dataFinal");
  if (finalDate !== "15/06/2026") {
    return JSON.stringify([]);
  }
  return JSON.stringify([{ data: "15/06/2026", valor: "0.05" }]);
}

function buildCalendarFixture(): string {
  return ["Data;Dia da Semana;Feriado;Tipo", "01/01/2026;quinta-feira;Ano Novo;Nacional"].join(
    "\n",
  );
}

function fakeFetch(): typeof fetch {
  return ((input: string) => {
    if (input.includes("InstDados/SerHist")) {
      return Promise.resolve(new Response(buildCotahistFixture(), { status: 200 }));
    }
    if (input.includes("InstrumentsConsolidated")) {
      return Promise.resolve(new Response(buildInstrumentsFixture(), { status: 200 }));
    }
    if (input.includes("bcdata.sgs")) {
      return Promise.resolve(new Response(buildSgsFixture(input), { status: 200 }));
    }
    if (input.includes("feriados")) {
      return Promise.resolve(new Response(buildCalendarFixture(), { status: 200 }));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }) as unknown as typeof fetch;
}

async function cleanup(): Promise<void> {
  const db = getDb();
  await db.delete(candles).where(eq(candles.ticker, STOCK_TICKER));
  await db.delete(optionDailyPrices).where(eq(optionDailyPrices.ticker, OPTION_TICKER));
  await db.delete(optionSeries).where(eq(optionSeries.ticker, OPTION_TICKER));
  await db.delete(ingestionRuns).where(eq(ingestionRuns.session, TEST_SESSION));
  await db.delete(ingestionRuns).where(eq(ingestionRuns.session, `${String(TEST_YEAR)}-01-01`));
  await db.delete(tradingSessions).where(eq(tradingSessions.date, "2026-01-01"));
  await db.delete(macroPoints).where(eq(macroPoints.date, TEST_SESSION));
}

afterEach(cleanup);

describe("ingest", () => {
  it("ingests all four sources for the target session and records a run per source", async () => {
    const db = getDb();
    const result = await ingest(db, {
      session: TEST_SESSION,
      now: new Date(`${TEST_SESSION}T22:00:00.000Z`),
      fetchImpl: fakeFetch(),
    });

    expect(result.session).toBe(TEST_SESSION);
    expect(result.sources.map((s) => s.source).sort()).toEqual(
      ["calendar", "cotahist", "instruments", "sgs"].sort(),
    );
    expect(result.sources.every((s) => s.error === undefined)).toBe(true);

    const [candleRow] = await db.select().from(candles).where(eq(candles.ticker, STOCK_TICKER));
    expect(candleRow?.close).toBe("1.08");

    const [optionPriceRow] = await db
      .select()
      .from(optionDailyPrices)
      .where(eq(optionDailyPrices.ticker, OPTION_TICKER));
    expect(optionPriceRow?.close).toBe("1.08");

    const [seriesRow] = await db
      .select()
      .from(optionSeries)
      .where(eq(optionSeries.ticker, OPTION_TICKER));
    expect(seriesRow?.strike).toBe("5.00000000");
  });

  it("is idempotent: re-running the same session changes nothing and skips already-succeeded sources", async () => {
    const db = getDb();
    const fetchSpy = fakeFetch();
    await ingest(db, { session: TEST_SESSION, now: new Date(), fetchImpl: fetchSpy });

    const secondRun = await ingest(db, {
      session: TEST_SESSION,
      now: new Date(),
      fetchImpl: fetchSpy,
    });

    expect(secondRun.sources.every((s) => s.skipped)).toBe(true);

    const candleRows = await db.select().from(candles).where(eq(candles.ticker, STOCK_TICKER));
    expect(candleRows).toHaveLength(1);

    const runs = await db
      .select()
      .from(ingestionRuns)
      .where(eq(ingestionRuns.session, TEST_SESSION));
    expect(runs).toHaveLength(3);
    expect(runs.every((run) => run.status === "succeeded")).toBe(true);
  });
});
