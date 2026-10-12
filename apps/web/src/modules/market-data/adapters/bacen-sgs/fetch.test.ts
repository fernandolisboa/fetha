import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SgsFetchError, SgsNotPublishedError, fetchSgsSeries, sgsUrl } from "./fetch";

function readFixture(name: string): string {
  return readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf-8");
}

const fixture = readFixture("sgs-cdi-sample.json");
// Recorded from api.bcb.gov.br on 2026-10-12: the CDI over a range with no
// published value yet, and a daily series asked for more than 10 years.
const notFoundBody = readFixture("sgs-not-found.json");
const windowTooWideBody = readFixture("sgs-window-too-wide.json");
// The nightly report only kept this body's first bytes ("<?xml vers"), so
// the fixture is representative, not recorded (#289).
const xmlErrorBody = readFixture("sgs-error-page.xml");

const sessions = [
  { date: "2026-01-01", open: "2026-01-01T13:00:00.000Z" },
  { date: "2026-09-09", open: "2026-09-09T13:00:00.000Z" },
];

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

describe("sgsUrl", () => {
  it("builds the SGS URL with dd/mm/yyyy dates and the series code", () => {
    expect(sgsUrl("cdi", "2026-01-01", "2026-09-08")).toBe(
      "https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=01%2F01%2F2026&dataFinal=08%2F09%2F2026",
    );
  });
});

describe("fetchSgsSeries", () => {
  it("parses the response through the SGS JSON parser", async () => {
    const points = await fetchSgsSeries(
      "cdi",
      "2026-01-01",
      "2026-09-08",
      sessions,
      fakeFetch(200, fixture),
    );
    expect(points).toHaveLength(5);
  });

  it("issues one request per 10-year window", async () => {
    let calls = 0;
    const countingFetch: typeof fetch = () => {
      calls += 1;
      return Promise.resolve(new Response(fixture, { status: 200 }));
    };

    await fetchSgsSeries("cdi", "2000-01-01", "2026-09-08", sessions, countingFetch);
    expect(calls).toBe(3);
  });

  it("throws SgsFetchError on a non-ok response", async () => {
    await expect(
      fetchSgsSeries("cdi", "2026-01-01", "2026-09-08", sessions, fakeFetch(503, ""), 0),
    ).rejects.toThrow(SgsFetchError);
  });

  it("throws SgsNotPublishedError when SGS answers its 'Value(s) not found' 404", async () => {
    await expect(
      fetchSgsSeries("cdi", "2026-09-26", "2026-09-28", sessions, fakeFetch(404, notFoundBody)),
    ).rejects.toThrow(SgsNotPublishedError);
  });

  it("reads the 'Value(s) not found' body as not yet published whatever the status", async () => {
    await expect(
      fetchSgsSeries("cdi", "2026-09-26", "2026-09-28", sessions, fakeFetch(200, notFoundBody)),
    ).rejects.toThrow(SgsNotPublishedError);
  });

  it("keeps the not-found body a failure on a 5xx, so an outage never reads as pending", async () => {
    const error = await rejectionOf(
      fetchSgsSeries("cdi", "2026-09-26", "2026-09-28", sessions, fakeFetch(500, notFoundBody), 0),
    );

    expect(error).toBeInstanceOf(SgsFetchError);
    expect(error).not.toBeInstanceOf(SgsNotPublishedError);
    expect(error).toMatchObject({ status: 500 });
  });

  it("names the status and content type of a JSON object body, never the body", async () => {
    const error = await rejectionOf(
      fetchSgsSeries(
        "cdi",
        "2026-09-26",
        "2026-09-28",
        sessions,
        fakeFetch(200, windowTooWideBody, "application/json; charset=utf-8"),
      ),
    );

    expect(error).toBeInstanceOf(SgsFetchError);
    expect(error).not.toBeInstanceOf(SgsNotPublishedError);
    expect(error).toMatchObject({
      status: 200,
      contentType: "application/json",
      message: "SGS returned an unexpected response for series cdi (HTTP 200, application/json)",
    });
  });

  it("keeps a non-ok JSON error object a typed failure without its text", async () => {
    const error = await rejectionOf(
      fetchSgsSeries(
        "cdi",
        "2000-01-01",
        "2009-12-31",
        sessions,
        fakeFetch(406, windowTooWideBody, "application/json; charset=utf-8"),
      ),
    );

    expect(error).toMatchObject({
      status: 406,
      message: "SGS fetch failed for series cdi (HTTP 406, application/json)",
    });
    expect((error as Error).message).not.toContain("janela");
  });

  it("names the status and content type of a non-JSON body, never the body", async () => {
    const error = await rejectionOf(
      fetchSgsSeries(
        "ipca",
        "2026-09-26",
        "2026-09-28",
        sessions,
        fakeFetch(200, xmlErrorBody, "text/xml;charset=ISO-8859-1"),
      ),
    );

    expect(error).toBeInstanceOf(SgsFetchError);
    expect(error).toMatchObject({
      status: 200,
      contentType: "text/xml",
      message: "SGS returned an unexpected response for series ipca (HTTP 200, text/xml)",
    });
  });

  it("reports a content type it cannot read as unknown", async () => {
    const error = await rejectionOf(
      fetchSgsSeries(
        "cdi",
        "2026-09-26",
        "2026-09-28",
        sessions,
        fakeFetch(200, xmlErrorBody, "text/<script>"),
      ),
    );

    expect(error).toMatchObject({ contentType: "unknown" });
  });

  it("retries a network failure once and parses the second answer", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      new TypeError("fetch failed"),
      { status: 200, body: fixture },
    ]);

    const points = await fetchSgsSeries("cdi", "2026-01-01", "2026-09-08", sessions, fetchImpl, 0);

    expect(points).toHaveLength(5);
    expect(calls()).toBe(2);
  });

  it("retries a 5xx once and parses the second answer", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      { status: 503, body: "" },
      { status: 200, body: fixture },
    ]);

    const points = await fetchSgsSeries("cdi", "2026-01-01", "2026-09-08", sessions, fetchImpl, 0);

    expect(points).toHaveLength(5);
    expect(calls()).toBe(2);
  });

  it("retries a connection that drops mid-body once", async () => {
    const droppedBody = new ReadableStream({
      start(controller) {
        controller.error(new TypeError("terminated"));
      },
    });
    const { fetchImpl, calls } = scriptedFetch([
      { status: 200, body: droppedBody },
      { status: 200, body: fixture },
    ]);

    const points = await fetchSgsSeries("cdi", "2026-01-01", "2026-09-08", sessions, fetchImpl, 0);

    expect(points).toHaveLength(5);
    expect(calls()).toBe(2);
  });

  it("retries a request that timed out once", async () => {
    const { fetchImpl, calls } = scriptedFetch([
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      { status: 200, body: fixture },
    ]);

    const points = await fetchSgsSeries("cdi", "2026-01-01", "2026-09-08", sessions, fetchImpl, 0);

    expect(points).toHaveLength(5);
    expect(calls()).toBe(2);
  });

  it("gives each attempt its own timeout signal", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const capturingFetch: typeof fetch = (_input, init) => {
      signals.push(init?.signal);
      const status = signals.length === 1 ? 503 : 200;
      return Promise.resolve(new Response(status === 200 ? fixture : "", { status }));
    };

    await fetchSgsSeries("cdi", "2026-01-01", "2026-09-08", sessions, capturingFetch, 0);

    expect(signals).toHaveLength(2);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).not.toBe(signals[0]);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("fails as a typed network error after the one retry also fails", async () => {
    const { fetchImpl, calls } = scriptedFetch([new TypeError("fetch failed")]);

    const error = await rejectionOf(
      fetchSgsSeries("selic", "2026-01-01", "2026-09-08", sessions, fetchImpl, 0),
    );

    expect(error).toBeInstanceOf(SgsFetchError);
    expect(error).toMatchObject({
      message: "SGS request failed for series selic (network error)",
    });
    expect(calls()).toBe(2);
  });

  it("does not retry an error that is not a network failure", async () => {
    const { fetchImpl, calls } = scriptedFetch([new RangeError("bad input")]);

    await expect(
      fetchSgsSeries("cdi", "2026-01-01", "2026-09-08", sessions, fetchImpl, 0),
    ).rejects.toThrow(RangeError);
    expect(calls()).toBe(1);
  });

  it("does not retry a 4xx or a not-yet-published answer", async () => {
    const notPublished = scriptedFetch([{ status: 404, body: notFoundBody }]);
    const badRequest = scriptedFetch([{ status: 400, body: "{}" }]);

    await expect(
      fetchSgsSeries("cdi", "2026-09-26", "2026-09-28", sessions, notPublished.fetchImpl, 0),
    ).rejects.toThrow(SgsNotPublishedError);
    await expect(
      fetchSgsSeries("cdi", "2026-09-26", "2026-09-28", sessions, badRequest.fetchImpl, 0),
    ).rejects.toThrow(SgsFetchError);
    expect(notPublished.calls()).toBe(1);
    expect(badRequest.calls()).toBe(1);
  });

  it("keeps any other 404 a plain fetch failure, not a not-yet-published one", async () => {
    const rejection = fetchSgsSeries(
      "cdi",
      "2026-09-26",
      "2026-09-28",
      sessions,
      fakeFetch(404, "<html>Not Found</html>"),
    );

    await expect(rejection).rejects.toThrow(SgsFetchError);
    await expect(rejection).rejects.not.toThrow(SgsNotPublishedError);
  });
});
