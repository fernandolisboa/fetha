import { zipSync } from "fflate";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/db/client";
import {
  candles,
  ingestionRuns,
  macroPoints,
  optionDailyPrices,
  optionSeries,
  tradingSessions,
} from "./schema";

import { calendarMarkerSession, ingest, runSource } from "./ingest";
import { ensureMonthlyPartition } from "./repositories/partitions";

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
    "RptDt;TckrSymb;Asst;ISIN;XprtnDt;OptnStyle;ExrcPric;OptnTp;SctyCtgyNm",
    `${session};${OPTION_TICKER};ZZT3;${OPTION_ISIN};2026-10-16;AMER;5,00;Call;OPTION ON EQUITIES`,
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

// Same shape as fakeFetch, but derives the requested session from the URL
// instead of closing over a single one, so it can answer for any of the
// sessions a gap-draining invocation attempts in one call.
function fakeFetchAnySession(): typeof fetch {
  return ((input: string) => {
    const cotahistMatch = /COTAHIST_D(\d{2})(\d{2})(\d{4})\.ZIP/.exec(input);
    if (cotahistMatch) {
      const [, dd = "", mm = "", yyyy = ""] = cotahistMatch;
      return Promise.resolve(
        new Response(buildCotahistFixture(`${yyyy}-${mm}-${dd}`) as unknown as BodyInit, {
          status: 200,
        }),
      );
    }
    if (input.includes("requestname")) {
      const date = new URL(input).searchParams.get("date") ?? "";
      return Promise.resolve(
        new Response(JSON.stringify({ token: `test-token-${date}` }), { status: 200 }),
      );
    }
    if (input.includes("api/download")) {
      const token = new URL(input).searchParams.get("token") ?? "";
      const session = token.replace("test-token-", "");
      return Promise.resolve(new Response(buildInstrumentsFixture(session), { status: 200 }));
    }
    if (input.includes("bcdata.sgs")) {
      const finalDate = new URL(input).searchParams.get("dataFinal") ?? "";
      return Promise.resolve(
        new Response(JSON.stringify([{ data: finalDate, valor: "0.05" }]), { status: 200 }),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }) as unknown as typeof fetch;
}

const OLDER_SESSION = "2026-06-12";
// Wide enough to cover every session the gap-draining test's
// RECENT_SESSION_WINDOW can reach back to from TEST_SESSION.
const WINDOW_FLOOR = "2026-05-01";

async function cleanup(): Promise<void> {
  const db = getDb();
  await db.delete(candles).where(eq(candles.ticker, STOCK_TICKER));
  await db.delete(optionDailyPrices).where(eq(optionDailyPrices.ticker, OPTION_TICKER));
  await db.delete(optionSeries).where(eq(optionSeries.isin, OPTION_ISIN));
  await db
    .delete(ingestionRuns)
    .where(and(gte(ingestionRuns.session, WINDOW_FLOOR), lte(ingestionRuns.session, TEST_SESSION)));
  await db.delete(macroPoints).where(eq(macroPoints.date, OLDER_SESSION));
  for (let year = 2024; year <= 2027; year += 1) {
    await db.delete(ingestionRuns).where(eq(ingestionRuns.session, calendarMarkerSession(year)));
  }
  await db.delete(macroPoints).where(eq(macroPoints.date, TEST_SESSION));
}

// Both before and after: the "drains" test below deliberately writes candles
// and ingestion runs for this same ticker across the whole gap window, and a
// query that expected exactly one such row (below) is otherwise fragile
// against any stray leftover from a run that failed mid-test.
beforeEach(cleanup);
afterEach(cleanup);

describe("ingest", () => {
  it("deletes a stored calendar date its year no longer lists, even on a run whose markers already succeeded", async () => {
    const db = getDb();
    const options = {
      session: TEST_SESSION,
      now: new Date(`${TEST_SESSION}T22:00:00.000Z`),
      fetchImpl: fakeFetch(TEST_SESSION),
    };
    await ingest(db, options);
    const unlisted = "2026-06-13";
    await db.insert(tradingSessions).values({
      date: unlisted,
      open: new Date(`${unlisted}T13:00:00.000Z`),
      close: new Date(`${unlisted}T20:00:00.000Z`),
    });
    const [before] = await db
      .select({ asOf: tradingSessions.asOf })
      .from(tradingSessions)
      .where(eq(tradingSessions.date, TEST_SESSION));

    try {
      const result = await ingest(db, options);

      const calendar = result.sources.find((s) => s.source === "calendar");
      expect(calendar?.skipped).toBe(false);
      expect(calendar?.error).toBeUndefined();
      const [removed] = await db
        .select()
        .from(tradingSessions)
        .where(eq(tradingSessions.date, unlisted));
      expect(removed).toBeUndefined();
      const [after] = await db
        .select({ asOf: tradingSessions.asOf })
        .from(tradingSessions)
        .where(eq(tradingSessions.date, TEST_SESSION));
      expect(after?.asOf.getTime()).toBeGreaterThan(before?.asOf.getTime() ?? Infinity);
    } finally {
      await db.delete(tradingSessions).where(eq(tradingSessions.date, unlisted));
    }
  });

  it("blocks the delete and reports it on the calendar outcome when a candle exists on the removed date", async () => {
    const db = getDb();
    const options = {
      session: TEST_SESSION,
      now: new Date(`${TEST_SESSION}T22:00:00.000Z`),
      fetchImpl: fakeFetch(TEST_SESSION),
    };
    await ingest(db, options);
    const unlisted = "2026-06-13";
    await db.insert(tradingSessions).values({
      date: unlisted,
      open: new Date(`${unlisted}T13:00:00.000Z`),
      close: new Date(`${unlisted}T20:00:00.000Z`),
    });
    await ensureMonthlyPartition(db, "candles", unlisted);
    await db.insert(candles).values({
      ticker: STOCK_TICKER,
      timeframe: "1d",
      session: unlisted,
      asOf: new Date(`${unlisted}T22:00:00.000Z`),
      open: "10",
      high: "10",
      low: "10",
      close: "10",
      tradedQuantity: 1,
    });

    try {
      const result = await ingest(db, options);

      const calendar = result.sources.find((s) => s.source === "calendar");
      expect(calendar?.skipped).toBe(false);
      expect(calendar?.error).toContain(unlisted);
      expect(result.ok).toBe(false);
      const [stillThere] = await db
        .select()
        .from(tradingSessions)
        .where(eq(tradingSessions.date, unlisted));
      expect(stillThere).toBeDefined();
    } finally {
      await db
        .delete(candles)
        .where(and(eq(candles.ticker, STOCK_TICKER), eq(candles.session, unlisted)));
      await db.delete(tradingSessions).where(eq(tradingSessions.date, unlisted));
    }
  });

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

    const [candleRow] = await db
      .select()
      .from(candles)
      .where(and(eq(candles.ticker, STOCK_TICKER), eq(candles.session, TEST_SESSION)));
    expect(candleRow?.close).toBe("1.080000");
    expect(candleRow?.asOf.toISOString()).toBe("2026-06-15T20:00:00.000Z");

    const [optionPriceRow] = await db
      .select()
      .from(optionDailyPrices)
      .where(
        and(
          eq(optionDailyPrices.ticker, OPTION_TICKER),
          eq(optionDailyPrices.session, TEST_SESSION),
        ),
      );
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

  it("reports sgs pending, not failed, when Bacen has not published the session's CDI yet, and fills it on a later run", async () => {
    const db = getDb();
    const published = fakeFetch(TEST_SESSION);
    const cdiNotPublished = ((input: string) =>
      input.includes("bcdata.sgs.12/")
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                erro: {
                  statusCode: 404,
                  detail:
                    "br.gov.bcb.pec.sgs.comum.excecoes.SGSNegocioException: Value(s) not found",
                },
              }),
              { status: 404 },
            ),
          )
        : published(input)) as unknown as typeof fetch;
    const sgsRuns = () =>
      db
        .select()
        .from(ingestionRuns)
        .where(and(eq(ingestionRuns.source, "sgs"), eq(ingestionRuns.session, TEST_SESSION)));

    const first = await ingest(db, {
      session: TEST_SESSION,
      now: new Date(`${TEST_SESSION}T22:00:00.000Z`),
      fetchImpl: cdiNotPublished,
    });

    expect(first.ok).toBe(true);
    const sgs = first.sources.find((source) => source.source === "sgs");
    expect(sgs).toMatchObject({ pending: true, skipped: false });
    expect(sgs?.error).toBeUndefined();
    expect(await sgsRuns()).toEqual([]);

    const second = await ingest(db, {
      session: TEST_SESSION,
      now: new Date(`${TEST_SESSION}T23:00:00.000Z`),
      fetchImpl: published,
    });

    expect(second.sources.find((source) => source.source === "sgs")?.pending).toBeUndefined();
    expect((await sgsRuns()).map((run) => run.status)).toEqual(["succeeded"]);
    const [cdi] = await db
      .select()
      .from(macroPoints)
      .where(and(eq(macroPoints.series, "cdi"), eq(macroPoints.date, TEST_SESSION)));
    expect(cdi).toBeDefined();
  });

  it("keeps only the newest gap pending: an older session whose CDI is still unpublished fails", async () => {
    const db = getDb();
    await db
      .delete(macroPoints)
      .where(and(eq(macroPoints.series, "cdi"), gte(macroPoints.date, WINDOW_FLOOR)));
    const anySession = fakeFetchAnySession();
    const cdiNeverPublished = ((input: string) =>
      input.includes("bcdata.sgs.12/")
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                erro: { statusCode: 404, detail: "SGSNegocioException: Value(s) not found" },
              }),
              { status: 404 },
            ),
          )
        : anySession(input)) as unknown as typeof fetch;

    const result = await ingest(db, {
      now: new Date(`${TEST_SESSION}T22:00:00.000Z`),
      fetchImpl: cdiNeverPublished,
    });

    const sgs = result.sources.find((source) => source.source === "sgs");
    expect(sgs?.pending).toBe(true);
    expect(sgs?.error).toContain("SGS has not published cdi");
    expect(result.ok).toBe(false);
    const sgsRuns = await db
      .select({ session: ingestionRuns.session, status: ingestionRuns.status })
      .from(ingestionRuns)
      .where(
        and(
          eq(ingestionRuns.source, "sgs"),
          gte(ingestionRuns.session, WINDOW_FLOOR),
          lte(ingestionRuns.session, TEST_SESSION),
        ),
      );
    expect(sgsRuns.length).toBeGreaterThan(0);
    expect(sgsRuns.every((run) => run.status === "failed")).toBe(true);
    expect(sgsRuns.map((run) => run.session)).not.toContain(TEST_SESSION);
  }, 120_000);

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

  it("drains every gap in the window, oldest first, in one invocation instead of pinning on a single session", async () => {
    const db = getDb();

    const result = await ingest(db, {
      now: new Date(`${TEST_SESSION}T22:00:00.000Z`),
      fetchImpl: fakeFetchAnySession(),
    });

    expect(result.ok).toBe(true);
    const cotahist = result.sources.find((s) => s.source === "cotahist");
    // rowCount sums stock + option rows per session across every drained gap.
    expect(cotahist?.rowCount).toBeGreaterThan(2);

    const succeededCotahistRuns = await db
      .select()
      .from(ingestionRuns)
      .where(
        and(
          eq(ingestionRuns.source, "cotahist"),
          eq(ingestionRuns.status, "succeeded"),
          gte(ingestionRuns.session, WINDOW_FLOOR),
          lte(ingestionRuns.session, TEST_SESSION),
        ),
      );
    const succeededSessions = succeededCotahistRuns.map((run) => run.session).sort();
    expect(succeededSessions).toContain(OLDER_SESSION);
    expect(succeededSessions).toContain(TEST_SESSION);
    expect(result.session).toBe(TEST_SESSION);

    const secondRun = await ingest(db, {
      now: new Date(`${TEST_SESSION}T22:00:00.000Z`),
      fetchImpl: fakeFetchAnySession(),
    });
    const secondCotahist = secondRun.sources.find((s) => s.source === "cotahist");
    expect(secondCotahist).toBeDefined();
    expect(secondCotahist?.skipped).toBe(true);
    expect(secondRun.session).toBe(TEST_SESSION);
  }, 120_000);

  it("reports session: null, not the latest closed session, when every drained gap fails", async () => {
    const db = getDb();
    const anySession = fakeFetchAnySession();
    const cotahistAlwaysFails: typeof fetch = ((input: string) => {
      if (input.includes("InstDados/SerHist")) {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      return anySession(input as unknown as RequestInfo);
    }) as unknown as typeof fetch;

    const result = await ingest(db, {
      now: new Date(`${TEST_SESSION}T22:00:00.000Z`),
      fetchImpl: cotahistAlwaysFails,
    });

    expect(result.ok).toBe(false);
    const cotahist = result.sources.find((s) => s.source === "cotahist");
    expect(cotahist?.error).toBeDefined();
    expect(result.session).toBeNull();
  }, 120_000);

  it("two concurrent invocations for the same session never both record a failed run", async () => {
    const db = getDb();
    const fetchSpy = fakeFetch(TEST_SESSION);

    const [first, second] = await Promise.all([
      ingest(db, {
        session: TEST_SESSION,
        now: new Date(`${TEST_SESSION}T22:00:00.000Z`),
        fetchImpl: fetchSpy,
      }),
      ingest(db, {
        session: TEST_SESSION,
        now: new Date(`${TEST_SESSION}T22:00:00.000Z`),
        fetchImpl: fetchSpy,
      }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const cotahistRuns = await db
      .select()
      .from(ingestionRuns)
      .where(and(eq(ingestionRuns.source, "cotahist"), eq(ingestionRuns.session, TEST_SESSION)));
    expect(cotahistRuns.filter((run) => run.status === "failed")).toHaveLength(0);
    expect(cotahistRuns.filter((run) => run.status === "succeeded")).toHaveLength(1);

    const [candleRow] = await db.select().from(candles).where(eq(candles.ticker, STOCK_TICKER));
    expect(candleRow?.close).toBe("1.080000");
  });
});

describe("runSource against a real database failure", () => {
  const FAILING_SESSION = "2026-06-19";

  afterEach(async () => {
    const db = getDb();
    await db
      .delete(ingestionRuns)
      .where(and(eq(ingestionRuns.source, "cotahist"), eq(ingestionRuns.session, FAILING_SESSION)));
  });

  it("stores no SQL statement or bound params in ingestion_runs.error for a failing write", async () => {
    const db = getDb();

    const outcome = await runSource(db, "cotahist", FAILING_SESSION, 300_000, async () => {
      await db.execute(sql`select 1 / 0`);
      return 0;
    });

    // Pins the real driver's cause-chain depth: db.execute's own division-by-zero
    // failure surfaces as a DrizzleQueryError whose cause is the Postgres error
    // (SQLSTATE 22012), not merely "some error" that happens not to leak.
    expect(outcome.error).toBe("22012");
    expect(outcome.error).not.toContain("Failed query");
    expect(outcome.error).not.toContain("params:");
    expect(outcome.error).not.toContain("select 1 / 0");

    const [failedRun] = await db
      .select()
      .from(ingestionRuns)
      .where(and(eq(ingestionRuns.source, "cotahist"), eq(ingestionRuns.session, FAILING_SESSION)));
    expect(failedRun?.status).toBe("failed");
    expect(failedRun?.error).toBe(outcome.error);
    expect(failedRun?.error).not.toContain("Failed query");
    expect(failedRun?.error).not.toContain("params:");
  });
});
