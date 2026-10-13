import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { fetchGdeltTimeline, gdeltUrl, mergeGdeltTimelines, parseGdeltBody } from "./fetch";
import { companyKeyword, gdeltQuery } from "./query";
import type { GdeltTimeline } from "./schema";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function timeline(name: string): GdeltTimeline {
  const parsed = parseGdeltBody(200, fixture(name));
  if (parsed.kind !== "ok") {
    throw new Error(`fixture ${name} did not parse`);
  }
  return parsed.value;
}

describe("companyKeyword", () => {
  it.each([
    ["PETRÓLEO BRASILEIRO S.A. - PETROBRAS", "petrobras"],
    ["VALE S.A.", "vale"],
    ["ITAÚ UNIBANCO HOLDING S/A", "itaú unibanco holding"],
    ['CIA "SANEAMENTO" BASICO LTDA', "cia saneamento basico"],
    ["XY SA", null],
  ])("%s → %s", (name, keyword) => {
    expect(companyKeyword(name)).toBe(keyword);
  });
});

describe("gdeltQuery", () => {
  it("searches the name or any ticker in Portuguese sources", () => {
    expect(gdeltQuery("PETRÓLEO BRASILEIRO S.A. - PETROBRAS", ["PETR4", "PETR3"])).toBe(
      '("petrobras" OR petr3 OR petr4) sourcelang:portuguese',
    );
  });

  it("caps the tickers and skips the parentheses for a single term", () => {
    expect(gdeltQuery(null, ["AAAA3", "AAAA4", "AAAA5", "AAAA6", "AAAA11"])).toBe(
      "(aaaa11 OR aaaa3 OR aaaa4 OR aaaa5) sourcelang:portuguese",
    );
    expect(gdeltQuery(null, ["VALE3"])).toBe("vale3 sourcelang:portuguese");
    expect(gdeltQuery(null, [])).toBeNull();
  });
});

describe("parseGdeltBody", () => {
  it("parses the recorded timelines", () => {
    expect(timeline("timelinetone.json").timeline[0]?.data).toHaveLength(5);
    expect(timeline("timelinevolraw.json").timeline[0]?.data[0]).toEqual({
      date: "20261006T000000Z",
      value: 42,
      norm: 61234,
    });
  });

  it("reads an empty object as no articles", () => {
    expect(parseGdeltBody(200, fixture("empty.json"))).toEqual({
      kind: "ok",
      value: { timeline: [] },
    });
  });

  it("reads GDELT's slow-down text or a 429 as rate limited", () => {
    expect(parseGdeltBody(200, fixture("rate-limited.txt"))).toEqual({ kind: "rate_limited" });
    expect(parseGdeltBody(429, "")).toEqual({ kind: "rate_limited" });
  });

  it("fails on an invalid query, an error status or an unexpected shape", () => {
    expect(parseGdeltBody(200, fixture("invalid-query.txt"))).toMatchObject({ kind: "failed" });
    expect(parseGdeltBody(500, "{}")).toMatchObject({ kind: "failed" });
    expect(parseGdeltBody(200, '{"timeline":[{"series":"x","data":[{"date":"bad"}]}]}')).toEqual({
      kind: "failed",
      reason: "unexpected shape",
    });
  });
});

describe("fetchGdeltTimeline", () => {
  it("asks for three months of the mode in JSON", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(fixture("timelinetone.json"))),
    );
    const result = await fetchGdeltTimeline(
      "petr4 sourcelang:portuguese",
      "timelinetone",
      fetchImpl,
    );
    expect(result.kind).toBe("ok");
    const url = new URL(gdeltUrl("petr4 sourcelang:portuguese", "timelinetone"));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: "petr4 sourcelang:portuguese",
      mode: "timelinetone",
      timespan: "3months",
      format: "json",
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(url.toString());
  });

  it("fails without throwing when GDELT does not answer", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new Error("timeout")));
    expect(await fetchGdeltTimeline("q", "timelinetone", fetchImpl)).toEqual({
      kind: "failed",
      reason: "no response",
    });
  });
});

describe("mergeGdeltTimelines", () => {
  it("joins tone and article count by day, as fixed-point strings", () => {
    expect(
      mergeGdeltTimelines(timeline("timelinetone.json"), timeline("timelinevolraw.json")),
    ).toEqual({
      kind: "ok",
      value: [
        { day: "2026-10-06", tone: "-1.2873", articles: 42 },
        { day: "2026-10-07", tone: "0.4512", articles: 37 },
        { day: "2026-10-08", tone: "0.0000", articles: 0 },
        { day: "2026-10-09", tone: "-3.0021", articles: 18 },
        { day: "2026-10-10", tone: "2.1500", articles: 5 },
      ],
    });
  });

  it("leaves out a day with articles but no tone rather than calling it neutral", () => {
    const tone: GdeltTimeline = { timeline: [{ series: "t", data: [] }] };
    const volume: GdeltTimeline = {
      timeline: [{ series: "v", data: [{ date: "20261006T000000Z", value: 3 }] }],
    };
    expect(mergeGdeltTimelines(tone, volume)).toEqual({ kind: "ok", value: [] });
  });

  it("keeps one point per day when the source repeats a day", () => {
    const tone: GdeltTimeline = {
      timeline: [
        {
          series: "t",
          data: [
            { date: "20261006T000000Z", value: 1 },
            { date: "20261006T120000Z", value: 2 },
          ],
        },
      ],
    };
    const volume: GdeltTimeline = {
      timeline: [
        {
          series: "v",
          data: [
            { date: "20261006T000000Z", value: 3 },
            { date: "20261006T120000Z", value: 4 },
          ],
        },
      ],
    };
    expect(mergeGdeltTimelines(tone, volume)).toEqual({
      kind: "ok",
      value: [{ day: "2026-10-06", tone: "2.0000", articles: 4 }],
    });
  });

  it("fails on an impossible count or tone", () => {
    const day = "20261006T000000Z";
    const volume = (value: number): GdeltTimeline => ({
      timeline: [{ series: "v", data: [{ date: day, value }] }],
    });
    const tone = (value: number): GdeltTimeline => ({
      timeline: [{ series: "t", data: [{ date: day, value }] }],
    });
    expect(mergeGdeltTimelines(tone(1), volume(1.5))).toMatchObject({ kind: "failed" });
    expect(mergeGdeltTimelines(tone(1), volume(-1))).toMatchObject({ kind: "failed" });
    expect(mergeGdeltTimelines(tone(250), volume(2))).toMatchObject({ kind: "failed" });
  });
});
