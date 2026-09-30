import { zipSync } from "fflate";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/db/client";
import {
  candles,
  ingestionRuns,
  macroPoints,
  optionDailyPrices,
  optionSeries,
  tradingSessions,
} from "./schema";

import { calendarMarkerSession, ingest, runSessionBoundSource, runSource } from "./ingest";
import { computeIvIndexForSession } from "./iv-index-compute";
import { ensureMonthlyPartition } from "./repositories/partitions";
import { succeededSessionsMissingRun } from "./repositories/ingestion-run-repository";
import { ivIndexPointsInRange } from "./repositories/iv-index-repository";
import { impliedVolatilityIndexPoints } from "./schema";

// Wraps the real implementation, so every test computes the IV index for
// real except the one that forces it to throw (#264).
vi.mock("./iv-index-compute", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./iv-index-compute")>();
  return { ...actual, computeIvIndexForSession: vi.fn(actual.computeIvIndexForSession) };
});
const computeIvIndexForSessionMock = vi.mocked(computeIvIndexForSession);

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
  // Also carries the prior trading session's own value (12/06/2026, a
  // Friday, the session immediately before TEST_SESSION on the real
  // calendar): the IV index needs a CDI point visible at TEST_SESSION's own
  // close, which — because CDI's `asOf` is the next session's open — can
  // only be a point dated on or before the previous trading session,
  // never TEST_SESSION's own same-day value.
  return JSON.stringify([
    { data: "12/06/2026", valor: "0.05" },
    { data: "15/06/2026", valor: "0.05" },
  ]);
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
afterEach(async () => {
  computeIvIndexForSessionMock.mockReset();
  await cleanup();
});

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
      ["calendar", "cotahist", "instruments", "iv_index", "sgs"].sort(),
    );
    expect(result.ok).toBe(true);
    expect(result.sources.every((s) => s.error === undefined)).toBe(true);
    expect(result.sources.find((s) => s.source === "iv_index")?.newestSessionComputed).toBe(true);

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
    expect(runs).toHaveLength(4);
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

  it("reports iv_index pending, not failed, when cotahist has not succeeded for the session yet, and never writes a run row for it", async () => {
    const db = getDb();
    const cotahistFailsForSession: typeof fetch = ((input: string) => {
      if (input.includes("InstDados/SerHist")) {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }
      return fakeFetch(TEST_SESSION)(input as unknown as RequestInfo);
    }) as unknown as typeof fetch;

    const result = await ingest(db, {
      session: TEST_SESSION,
      now: new Date(`${TEST_SESSION}T22:00:00.000Z`),
      fetchImpl: cotahistFailsForSession,
    });

    const cotahist = result.sources.find((s) => s.source === "cotahist");
    expect(cotahist?.error).toBeDefined();
    const ivIndex = result.sources.find((s) => s.source === "iv_index");
    expect(ivIndex).toMatchObject({ pending: true, skipped: false, rowCount: 0 });
    expect(ivIndex?.error).toBeUndefined();

    const ivIndexRuns = await db
      .select()
      .from(ingestionRuns)
      .where(and(eq(ingestionRuns.source, "iv_index"), eq(ingestionRuns.session, TEST_SESSION)));
    expect(ivIndexRuns).toEqual([]);
  });

  it("keeps a failing iv_index out of ok while its own outcome carries the error (#264)", async () => {
    const db = getDb();
    computeIvIndexForSessionMock.mockRejectedValueOnce(new Error("iv index exploded"));

    const result = await ingest(db, {
      session: TEST_SESSION,
      now: new Date(`${TEST_SESSION}T22:00:00.000Z`),
      fetchImpl: fakeFetch(TEST_SESSION),
    });

    expect(result.ok).toBe(true);
    expect(result.session).toBe(TEST_SESSION);
    expect(
      result.sources.filter((s) => s.source !== "iv_index").every((s) => s.error === undefined),
    ).toBe(true);
    const ivIndex = result.sources.find((s) => s.source === "iv_index");
    expect(ivIndex?.error).toContain("iv index exploded");
    expect(ivIndex?.newestSessionComputed).toBe(false);

    const [ivIndexRun] = await db
      .select()
      .from(ingestionRuns)
      .where(and(eq(ingestionRuns.source, "iv_index"), eq(ingestionRuns.session, TEST_SESSION)));
    expect(ivIndexRun?.status).toBe("failed");
  });

  it("still starts the sole (newest) iv_index session once its ordinary 40% start budget has elapsed, since only the 60% hard stop gates it", async () => {
    const db = getDb();

    const result = await ingest(db, {
      session: TEST_SESSION,
      now: new Date(`${TEST_SESSION}T22:00:00.000Z`),
      fetchImpl: fakeFetch(TEST_SESSION),
      ivIndexBudgetMs: 0,
    });

    const cotahist = result.sources.find((s) => s.source === "cotahist");
    expect(cotahist?.error).toBeUndefined();
    const instruments = result.sources.find((s) => s.source === "instruments");
    expect(instruments?.error).toBeUndefined();

    const ivIndex = result.sources.find((s) => s.source === "iv_index");
    expect(ivIndex?.error).toBeUndefined();
    expect(ivIndex?.skipped).toBe(false);

    const ivIndexRuns = await db
      .select()
      .from(ingestionRuns)
      .where(and(eq(ingestionRuns.source, "iv_index"), eq(ingestionRuns.session, TEST_SESSION)));
    expect(ivIndexRuns).toHaveLength(1);
    expect(ivIndexRuns[0]?.status).toBe("succeeded");
  });

  it("defers every session left unattempted once a source's start deadline has already elapsed, without attempting or recording them", async () => {
    const db = getDb();
    let calls = 0;
    const run = () => {
      calls += 1;
      return Promise.resolve(0);
    };

    const { outcome, okSessions } = await runSessionBoundSource(
      db,
      "iv_index",
      ["2091-01-05", "2091-01-06"],
      120_000,
      run,
      Date.now() - 1,
    );

    expect(calls).toBe(0);
    expect(okSessions).toEqual([]);
    expect(outcome).toEqual({
      source: "iv_index",
      skipped: false,
      rowCount: 0,
      pending: true,
      deferred: 2,
    });

    const runs = await db
      .select()
      .from(ingestionRuns)
      .where(
        and(
          eq(ingestionRuns.source, "iv_index"),
          inArray(ingestionRuns.session, ["2091-01-05", "2091-01-06"]),
        ),
      );
    expect(runs).toEqual([]);
  });

  it("backfills iv_index for an old session whose cotahist and instruments already succeeded outside the current recent window", async () => {
    const db = getDb();
    const now = new Date(`${TEST_SESSION}T22:00:00.000Z`);

    await ingest(db, { session: TEST_SESSION, now, fetchImpl: fakeFetch(TEST_SESSION) });

    const oldSessions = await db
      .select()
      .from(tradingSessions)
      .where(lte(tradingSessions.date, "2024-06-01"))
      .orderBy(asc(tradingSessions.date))
      .limit(50);
    const oldSession = oldSessions[0]?.date ?? "";
    const expiryLower = oldSessions[20]?.date ?? "";
    const expiryUpper = oldSessions[40]?.date ?? "";
    const oldSessionClose = oldSessions[0]?.close ?? new Date(0);

    const underlying = `ZBF${crypto.randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase()}`;
    const tickerLower = `${underlying}CL`;
    const tickerUpper = `${underlying}CH`;

    await db.insert(ingestionRuns).values([
      {
        source: "cotahist",
        session: oldSession,
        status: "succeeded",
        startedAt: now,
        finishedAt: now,
        rowCount: 1,
      },
      {
        source: "instruments",
        session: oldSession,
        status: "succeeded",
        startedAt: now,
        finishedAt: now,
        rowCount: 1,
      },
    ]);
    await db.insert(macroPoints).values({
      series: "cdi",
      date: oldSession,
      asOf: oldSessionClose,
      annualRate: "0.00000000",
    });
    await ensureMonthlyPartition(db, "candles", oldSession);
    await db.insert(candles).values({
      ticker: underlying,
      timeframe: "1d",
      session: oldSession,
      asOf: oldSessionClose,
      open: "50",
      high: "50",
      low: "50",
      close: "50",
      tradedQuantity: 1,
    });
    await db.insert(optionSeries).values([
      {
        isin: `ISIN-${tickerLower}`,
        ticker: tickerLower,
        underlying,
        right: "call",
        strike: "50.00000000",
        expiry: expiryLower,
        style: "european",
        asOf: oldSessionClose,
      },
      {
        isin: `ISIN-${tickerUpper}`,
        ticker: tickerUpper,
        underlying,
        right: "call",
        strike: "50.00000000",
        expiry: expiryUpper,
        style: "european",
        asOf: oldSessionClose,
      },
    ]);
    await ensureMonthlyPartition(db, "option_daily_prices", oldSession);
    await db.insert(optionDailyPrices).values([
      {
        ticker: tickerLower,
        session: oldSession,
        asOf: oldSessionClose,
        right: "call",
        strike: "50.00000000",
        expiry: expiryLower,
        average: "1.500000",
        close: "1.500000",
        trades: 1,
        tradedQuantity: 100,
      },
      {
        ticker: tickerUpper,
        session: oldSession,
        asOf: oldSessionClose,
        right: "call",
        strike: "50.00000000",
        expiry: expiryUpper,
        average: "2.500000",
        close: "2.500000",
        trades: 1,
        tradedQuantity: 100,
      },
    ]);

    try {
      const candidatesBefore = await succeededSessionsMissingRun(
        db,
        ["cotahist", "instruments"],
        "iv_index",
      );
      expect(candidatesBefore).toContain(oldSession);
      expect(candidatesBefore).toEqual([...candidatesBefore].sort().reverse());

      await ingest(db, { now, fetchImpl: fakeFetchAnySession() });

      const [ivIndexRun] = await db
        .select()
        .from(ingestionRuns)
        .where(and(eq(ingestionRuns.source, "iv_index"), eq(ingestionRuns.session, oldSession)));
      expect(ivIndexRun?.status).toBe("succeeded");

      const points = await ivIndexPointsInRange(db, [underlying], oldSession, oldSession);
      expect(points).toHaveLength(1);
    } finally {
      await db
        .delete(ingestionRuns)
        .where(
          and(
            inArray(ingestionRuns.source, ["cotahist", "instruments", "iv_index"]),
            eq(ingestionRuns.session, oldSession),
          ),
        );
      await db.delete(macroPoints).where(eq(macroPoints.date, oldSession));
      await db.delete(candles).where(eq(candles.ticker, underlying));
      await db.delete(optionSeries).where(eq(optionSeries.underlying, underlying));
      await db
        .delete(optionDailyPrices)
        .where(inArray(optionDailyPrices.ticker, [tickerLower, tickerUpper]));
      await db
        .delete(impliedVolatilityIndexPoints)
        .where(eq(impliedVolatilityIndexPoints.underlying, underlying));
    }
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
