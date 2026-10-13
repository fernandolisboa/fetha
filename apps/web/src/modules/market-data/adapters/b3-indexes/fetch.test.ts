import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { IndexFetchError, fetchIndexYear, indexStatisticsUrl } from "./fetch";

function readFixture(name: string): string {
  return readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf-8");
}

const fixture2026 = readFixture("ibov-2026-sample.json");

function fakeFetch(status: number, body: string, contentType?: string): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(body, {
        status,
        headers: contentType === undefined ? {} : { "content-type": contentType },
      }),
    );
}

type Reply = Error | { status: number; body: string | ReadableStream };

function scriptedFetch(replies: Reply[]): { fetchImpl: typeof fetch; calls: () => number } {
  let calls = 0;
  const fetchImpl: typeof fetch = () => {
    const reply = replies[Math.min(calls, replies.length - 1)];
    calls += 1;
    if (reply === undefined || reply instanceof Error) {
      return Promise.reject(reply ?? new Error("no scripted reply"));
    }
    return Promise.resolve(new Response(reply.body, { status: reply.status }));
  };
  return { fetchImpl, calls: () => calls };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error,
  );
}

describe("indexStatisticsUrl", () => {
  it("builds the GetPortfolioDay URL from the base64 of the exact request JSON", () => {
    const expected = Buffer.from(
      JSON.stringify({ index: "IBOV", language: "pt-br", year: "2026" }),
      "utf8",
    ).toString("base64");
    expect(indexStatisticsUrl(2026)).toBe(
      `https://sistemaswebb3-listados.b3.com.br/indexStatisticsProxy/IndexCall/GetPortfolioDay/${expected}`,
    );
  });
});

describe("fetchIndexYear", () => {
  it("parses the response through the index year parser", async () => {
    const points = await fetchIndexYear(2026, fakeFetch(200, fixture2026));
    expect(points.length).toBeGreaterThan(0);
    expect(points.at(-1)).toEqual({ date: "2026-10-09", close: "209066.900000" });
  });

  it("throws IndexFetchError on a non-ok response", async () => {
    await expect(fetchIndexYear(2026, fakeFetch(503, ""), 0)).rejects.toThrow(IndexFetchError);
  });

  it("treats results: null as a known-empty answer, not an error", async () => {
    const points = await fetchIndexYear(
      2099,
      fakeFetch(200, '{"min":null,"max":null,"results":null}'),
    );
    expect(points).toEqual([]);
  });

  it("throws IndexFetchError on a non-JSON body", async () => {
    await expect(
      fetchIndexYear(2026, fakeFetch(200, "<html>nope</html>", "text/html"), 0),
    ).rejects.toThrow(IndexFetchError);
  });

  it("retries a network failure once and parses the second answer", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      new TypeError("fetch failed"),
      { status: 200, body: fixture2026 },
    ]);

    const points = await fetchIndexYear(2026, fetchImpl, 0);

    expect(points.length).toBeGreaterThan(0);
    expect(calls()).toBe(2);
  });

  it("retries a 5xx once and parses the second answer", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 503, body: "" },
      { status: 200, body: fixture2026 },
    ]);

    const points = await fetchIndexYear(2026, fetchImpl, 0);

    expect(points.length).toBeGreaterThan(0);
    expect(calls()).toBe(2);
  });

  it("fails as a typed network error after the one retry also fails", async () => {
    const { fetchImpl, calls } = scriptedFetch([new TypeError("fetch failed")]);

    const error = await rejectionOf(fetchIndexYear(2026, fetchImpl, 0));

    expect(error).toBeInstanceOf(IndexFetchError);
    expect(calls()).toBe(2);
  });

  it("does not retry an error that is not a network failure", async () => {
    const { fetchImpl, calls } = scriptedFetch([new RangeError("bad input")]);

    await expect(fetchIndexYear(2026, fetchImpl, 0)).rejects.toThrow(RangeError);
    expect(calls()).toBe(1);
  });

  it("gives each attempt its own timeout signal", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const capturingFetch: typeof fetch = (_input, init) => {
      signals.push(init?.signal);
      const status = signals.length === 1 ? 503 : 200;
      return Promise.resolve(new Response(status === 200 ? fixture2026 : "", { status }));
    };

    await fetchIndexYear(2026, capturingFetch, 0);

    expect(signals).toHaveLength(2);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).not.toBe(signals[0]);
  });
});
