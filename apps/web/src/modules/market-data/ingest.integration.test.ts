import { zipSync } from "fflate";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import {
  candles,
  ingestionRuns,
  macroPoints,
  optionDailyPrices,
  optionSeries,
} from "@/db/schema/market-data";

import { ingest } from "./ingest";

const TEST_SESSION = "2026-06-15";
const STOCK_TICKER = "ZZT3";
const OPTION_TICKER = "ZZTW999";
const OPTION_ISIN = "BRZZZTOPTW01";

function padRight(value: string, length: number): string {
  return value.slice(0, length).padEnd(length, " ");
}
function padLeft(value: string, length: number): string {
  return value.slice(0, length).padStart(length, "0");
}

function buildCotahistFixture(session: string): Uint8Array {
  function baseRow(tpmerc: string, ticker: string): string {
    let row = "01";
    row += session.replaceAll("-", "");
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
    `00COTAHIST.2026${padRight("BOVESPA", 7)}${session.replaceAll("-", "")}`,
    245,
  );
  const stock = baseRow("010", STOCK_TICKER);
  const option = baseRow("070", OPTION_TICKER);
  const trailer = padRight("9900003", 245);
  const content = [header, stock, option, trailer].join("\r\n");
  return zipSync({
    [`COTAHIST_D${session.split("-").reverse().join("")}.TXT`]: new TextEncoder().encode(content),
  });
}

function buildInstrumentsFixture(session: string): string {
  return [
    "Status do Arquivo: Final",
    "RptDt;TckrSymb;Asst;ISIN;XprtnDt;OptnStyle;ExrcPric;OptnTp",
    `${session};${OPTION_TICKER};ZZT3;${OPTION_ISIN};2026-10-16;AMER;5,00;Call`,
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

function fakeFetch(session: string): typeof fetch {
  return ((input: string) => {
    if (input.includes("InstDados/SerHist")) {
      return Promise.resolve(
        new Response(buildCotahistFixture(session) as unknown as BodyInit, { status: 200 }),
      );
    }
    if (input.includes("requestname")) {
      return Promise.resolve(
        new Response(JSON.stringify({ token: "test-token" }), { status: 200 }),
      );
    }
    if (input.includes("api/download")) {
      return Promise.resolve(new Response(buildInstrumentsFixture(session), { status: 200 }));
    }
    if (input.includes("bcdata.sgs")) {
      return Promise.resolve(new Response(buildSgsFixture(input), { status: 200 }));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }) as unknown as typeof fetch;
}

async function cleanup(): Promise<void> {
  const db = getDb();
  await db.delete(candles).where(eq(candles.ticker, STOCK_TICKER));
  await db.delete(optionDailyPrices).where(eq(optionDailyPrices.ticker, OPTION_TICKER));
  await db.delete(optionSeries).where(eq(optionSeries.isin, OPTION_ISIN));
  await db.delete(ingestionRuns).where(eq(ingestionRuns.session, TEST_SESSION));
  for (let year = 2024; year <= 2027; year += 1) {
    await db.delete(ingestionRuns).where(eq(ingestionRuns.session, `${String(year)}-01-01`));
  }
  await db.delete(macroPoints).where(eq(macroPoints.date, TEST_SESSION));
}

afterEach(cleanup);

describe("ingest", () => {
  it("ingests all four sources for the target session and records a run per source", async () => {
    const db = getDb();
    const result = await ingest(db, {
      session: TEST_SESSION,
      now: new Date(`${TEST_SESSION}T22:00:00.000Z`),
      fetchImpl: fakeFetch(TEST_SESSION),
    });

    expect(result.session).toBe(TEST_SESSION);
    expect(result.sources.map((s) => s.source).sort()).toEqual(
      ["calendar", "cotahist", "instruments", "sgs"].sort(),
    );
    expect(result.ok).toBe(true);
    expect(result.sources.every((s) => s.error === undefined)).toBe(true);

    const [candleRow] = await db.select().from(candles).where(eq(candles.ticker, STOCK_TICKER));
    expect(candleRow?.close).toBe("1.080000");
    expect(candleRow?.asOf.toISOString()).toBe("2026-06-15T20:00:00.000Z");

    const [optionPriceRow] = await db
      .select()
      .from(optionDailyPrices)
      .where(eq(optionDailyPrices.ticker, OPTION_TICKER));
    expect(optionPriceRow?.close).toBe("1.080000");
    expect(optionPriceRow?.right).toBe("call");
    expect(optionPriceRow?.strike).toBe("5.00000000");

    const [seriesRow] = await db
      .select()
      .from(optionSeries)
      .where(eq(optionSeries.isin, OPTION_ISIN));
    expect(seriesRow?.strike).toBe("5.00000000");
    expect(seriesRow?.ticker).toBe(OPTION_TICKER);
  });

  it("is idempotent: re-running the same session changes nothing and skips already-succeeded sources", async () => {
    const db = getDb();
    const fetchSpy = fakeFetch(TEST_SESSION);
    await ingest(db, {
      session: TEST_SESSION,
      now: new Date(`${TEST_SESSION}T22:00:00.000Z`),
      fetchImpl: fetchSpy,
    });

    const secondRun = await ingest(db, {
      session: TEST_SESSION,
      now: new Date(`${TEST_SESSION}T23:00:00.000Z`),
      fetchImpl: fetchSpy,
    });

    expect(secondRun.sources.every((s) => s.skipped)).toBe(true);

    const candleRows = await db.select().from(candles).where(eq(candles.ticker, STOCK_TICKER));
    expect(candleRows).toHaveLength(1);

    const runs = await db
      .select()
      .from(ingestionRuns)
      .where(and(eq(ingestionRuns.session, TEST_SESSION), eq(ingestionRuns.status, "succeeded")));
    expect(runs).toHaveLength(3);
  });

  it("rejects a COTAHIST file whose DATA field does not match the requested session and records the run as failed", async () => {
    const db = getDb();
    const mismatchedFetch: typeof fetch = ((input: string) => {
      if (input.includes("InstDados/SerHist")) {
        return Promise.resolve(
          new Response(buildCotahistFixture("2026-06-16") as unknown as BodyInit, {
            status: 200,
          }),
        );
      }
      return fakeFetch(TEST_SESSION)(input as unknown as RequestInfo);
    }) as unknown as typeof fetch;

    const result = await ingest(db, {
      session: TEST_SESSION,
      now: new Date(`${TEST_SESSION}T22:00:00.000Z`),
      fetchImpl: mismatchedFetch,
    });

    expect(result.ok).toBe(false);
    const cotahist = result.sources.find((s) => s.source === "cotahist");
    expect(cotahist?.error).toBeDefined();

    const [failedRun] = await db
      .select()
      .from(ingestionRuns)
      .where(and(eq(ingestionRuns.source, "cotahist"), eq(ingestionRuns.session, TEST_SESSION)));
    expect(failedRun?.status).toBe("failed");
  });
});
