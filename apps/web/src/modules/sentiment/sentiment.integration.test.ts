import { and, eq, inArray } from "drizzle-orm";
import type { DecimalString, FilingLabelInputs } from "@fetha/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/db/client";
import { deleteTestUser } from "@/db/test/cleanup";
import { seedRadarFinding } from "@/db/test/radar-finding";
import { todaySaoPauloDate } from "@/lib/today-sao-paulo";
import { user } from "@/modules/auth/schema";
import { companyFilings, companyTickers } from "@/modules/market-data/schema";
import { watchlistItems } from "@/modules/watchlist/schema";

import type { FilingLabelClient, FilingLabelReply } from "./filing-label-model";
import { labelFilings } from "./label-filings";
import type { NewsSentimentProvider, ProviderArticle } from "./news-sentiment-provider";
import { refreshNewsTone } from "./news-tone-job";
import { refreshProviderArticles } from "./provider-articles-job";
import { sentimentForInstrument } from "./queries";
import { recordFinalFilingLabel } from "./repositories/filing-label-repository";
import { insertNewsArticles } from "./repositories/news-repository";
import { runSentimentJob } from "./run-sentiment-job";
import { filingLabels, newsArticles, newsTonePoints, sentimentFetches } from "./schema";
import { sentimentUniverse } from "./universe";

const DAY_MS = 24 * 60 * 60 * 1000;
const noSleep = () => Promise.resolve();

interface Fixture {
  cnpj: string;
  tickers: string[];
  protocols: string[];
  emails: string[];
}

const fixtures: Fixture[] = [];
const radarCleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  const db = getDb();
  for (const cleanup of radarCleanups.splice(0)) {
    await cleanup();
  }
  for (const fixture of fixtures.splice(0)) {
    if (fixture.protocols.length > 0) {
      await db.delete(filingLabels).where(inArray(filingLabels.protocol, fixture.protocols));
      await db.delete(companyFilings).where(inArray(companyFilings.protocol, fixture.protocols));
    }
    await db.delete(companyTickers).where(eq(companyTickers.cnpj, fixture.cnpj));
    await db.delete(newsTonePoints).where(eq(newsTonePoints.cnpj, fixture.cnpj));
    await db
      .delete(sentimentFetches)
      .where(inArray(sentimentFetches.subject, [fixture.cnpj, ...fixture.tickers]));
    await db.delete(newsArticles).where(inArray(newsArticles.ticker, fixture.tickers));
    for (const email of fixture.emails) {
      await deleteTestUser(db, email);
    }
  }
});

function randomLetters(length: number): string {
  return Array.from({ length }, () =>
    String.fromCharCode(65 + Math.floor(Math.random() * 26)),
  ).join("");
}

function daysAgo(days: number, from: Date = new Date()): string {
  return new Date(from.getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

async function company(tickerCount = 2): Promise<Fixture> {
  const root = randomLetters(4);
  const fixture: Fixture = {
    cnpj: String(Math.floor(Math.random() * 1e14)).padStart(14, "0"),
    tickers: [`${root}3`, `${root}4`].slice(0, tickerCount),
    protocols: [],
    emails: [],
  };
  fixtures.push(fixture);
  await getDb()
    .insert(companyTickers)
    .values(
      fixture.tickers.map((ticker) => ({ ticker, cnpj: fixture.cnpj, referenceDate: daysAgo(30) })),
    );
  return fixture;
}

let protocolSeq = 0;

async function filing(
  fixture: Fixture,
  options: { deliveredOn: string; version?: number; protocol?: string; subject?: string },
): Promise<{ protocol: string; version: number; documentUrl: string }> {
  protocolSeq += 1;
  const protocol = options.protocol ?? `${fixture.cnpj}-${String(protocolSeq)}`;
  const version = options.version ?? 1;
  const documentUrl = `https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?numProtocolo=${protocol}&v=${String(version)}`;
  if (!fixture.protocols.includes(protocol)) {
    fixture.protocols.push(protocol);
  }
  await getDb()
    .insert(companyFilings)
    .values({
      protocol,
      version,
      cnpj: fixture.cnpj,
      companyName: "EMPRESA TESTE S.A. - TESTE",
      category: "material_fact",
      kind: null,
      subject: options.subject ?? "Fato relevante",
      deliveredOn: options.deliveredOn,
      documentUrl,
    });
  return { protocol, version, documentUrl };
}

async function watch(fixture: Fixture, tickers: readonly string[]): Promise<void> {
  const email = `fetha-sentiment-${crypto.randomUUID()}@example.com`;
  fixture.emails.push(email);
  const id = crypto.randomUUID();
  await getDb().insert(user).values({
    id,
    name: "Test User",
    email,
    emailVerified: true,
    termsVersion: "2026-09-09",
    termsAcceptedAt: new Date(),
  });
  await getDb()
    .insert(watchlistItems)
    .values(tickers.map((ticker) => ({ userId: id, ticker })));
}

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

function radFetch(bodies: Record<string, "pdf" | "html" | "docx">) {
  return vi.fn<typeof fetch>((input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const kind = Object.entries(bodies).find(([marker]) => url.includes(marker))?.[1] ?? "html";
    const body =
      kind === "pdf"
        ? PDF.slice()
        : kind === "docx"
          ? new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])
          : "<html>Aguarde</html>";
    return Promise.resolve(new Response(body));
  });
}

function labelClient(reply: (inputs: FilingLabelInputs) => FilingLabelReply) {
  const label = vi.fn<FilingLabelClient["label"]>(({ inputs }) => Promise.resolve(reply(inputs)));
  return { client: { label } satisfies FilingLabelClient, label };
}

const usage = { inputTokens: 2100, outputTokens: 55 };
const goodReply = (): FilingLabelReply => ({
  kind: "parsed",
  output: {
    topic: "dividends",
    tone: "positive",
    summary: "A companhia aprovou o pagamento de proventos aos acionistas.",
  },
  model: "claude-haiku-5-5",
  usage,
});

async function labelsOf(protocols: readonly string[]) {
  return getDb()
    .select()
    .from(filingLabels)
    .where(inArray(filingLabels.protocol, [...protocols]))
    .orderBy(filingLabels.protocol, filingLabels.version);
}

function deadline(): number {
  return Date.now() + 10 * 60 * 1000;
}

describe("sentimentUniverse", () => {
  it("groups every watched ticker under its company and keeps ETFs as bare tickers", async () => {
    const fixture = await company();
    const etf = `${randomLetters(4)}11`;
    fixture.tickers.push(etf);
    await watch(fixture, fixture.tickers);
    await filing(fixture, { deliveredOn: daysAgo(3) });

    const universe = await sentimentUniverse(getDb());

    expect(universe.tickers).toEqual(expect.arrayContaining(fixture.tickers));
    expect(universe.companies.find((entry) => entry.cnpj === fixture.cnpj)).toEqual({
      cnpj: fixture.cnpj,
      companyName: "EMPRESA TESTE S.A. - TESTE",
      tickers: fixture.tickers.slice(0, 2).sort(),
    });
  });

  it("ADR-0062: excludes a market index even when it is on a watchlist", async () => {
    const fixture = await company();
    await watch(fixture, [...fixture.tickers, "IBOV11"]);

    const universe = await sentimentUniverse(getDb());

    expect(universe.tickers).not.toContain("IBOV11");
  });
});

// Far-future sessions: newer than any other read session in the database, so they are the
// radar's window whatever else the suite seeded.
const RADAR_SESSIONS = [
  "2190-03-06",
  "2190-03-05",
  "2190-03-04",
  "2190-03-03",
  "2190-03-02",
  "2190-03-01",
];

async function radarFinding(ticker: string, sessionIndex: number): Promise<void> {
  const session = RADAR_SESSIONS[sessionIndex] ?? "";
  radarCleanups.push(await seedRadarFinding(getDb(), ticker, session));
}

describe("sentimentUniverse with the radar's findings (docs/adr/0065)", () => {
  it("adds the underlyings found in the last five read sessions and drops older ones", async () => {
    const inside = await company();
    const outside = await company();
    await radarFinding(inside.tickers[0] ?? "", 4);
    await radarFinding(outside.tickers[0] ?? "", 5);
    for (const [index, filler] of ["ZZAA3", "ZZAB3", "ZZAC3", "ZZAD3"].entries()) {
      await radarFinding(filler, index);
    }

    const universe = await sentimentUniverse(getDb());

    expect(universe.tickers).toContain(inside.tickers[0]);
    expect(universe.tickers).not.toContain(outside.tickers[0]);
    expect(universe.companies.find((entry) => entry.cnpj === outside.cnpj)).toBeUndefined();
  });

  it("excludes a market index the radar found", async () => {
    await radarFinding("IBOV11", 0);

    const universe = await sentimentUniverse(getDb());

    expect(universe.tickers).not.toContain("IBOV11");
  });

  it("lists the watchlist first and never twice, in tickers and in companies", async () => {
    const watched = await company();
    const found = await company();
    await watch(watched, watched.tickers);
    await radarFinding(found.tickers[0] ?? "", 0);
    await radarFinding(watched.tickers[0] ?? "", 0);

    const universe = await sentimentUniverse(getDb());

    expect(universe.tickers.filter((ticker) => ticker === watched.tickers[0])).toHaveLength(1);
    const watchedAt = Math.max(
      ...watched.tickers.map((ticker) => universe.tickers.indexOf(ticker)),
    );
    expect(watchedAt).toBeLessThan(universe.tickers.indexOf(found.tickers[0] ?? ""));
    const cnpjs = universe.companies.map((entry) => entry.cnpj);
    expect(cnpjs.filter((cnpj) => cnpj === watched.cnpj)).toHaveLength(1);
    expect(cnpjs.indexOf(watched.cnpj)).toBeLessThan(cnpjs.indexOf(found.cnpj));
  });

  it("adds at most 40 radar underlyings, newest session first, on top of the watchlist", async () => {
    const watched = await company();
    await watch(watched, watched.tickers);
    const older = Array.from({ length: 10 }, (_, index) => `ZY${String(index).padStart(2, "0")}3`);
    const newest = Array.from({ length: 45 }, (_, index) => `ZX${String(index).padStart(2, "0")}3`);
    for (const ticker of older) await radarFinding(ticker, 1);
    for (const ticker of newest) await radarFinding(ticker, 0);

    const universe = await sentimentUniverse(getDb());

    const found = universe.tickers.filter((ticker) => /^Z[XY]\d\d3$/.test(ticker));
    expect(found).toHaveLength(40);
    expect(found.every((ticker) => newest.includes(ticker))).toBe(true);
    expect(universe.tickers.slice(0, watched.tickers.length)).toEqual(
      expect.arrayContaining(watched.tickers),
    );
  });

  it("groups radar tickers by company and keeps one with no company as a bare ticker", async () => {
    const found = await company();
    const bare = `${randomLetters(4)}11`;
    await radarFinding(found.tickers[0] ?? "", 0);
    await radarFinding(found.tickers[1] ?? "", 0);
    await radarFinding(bare, 0);

    const universe = await sentimentUniverse(getDb());

    expect(universe.tickers).toContain(bare);
    expect(universe.companies.find((entry) => entry.cnpj === found.cnpj)?.tickers).toEqual(
      [...found.tickers].sort(),
    );
    expect(universe.companies.flatMap((entry) => entry.tickers)).not.toContain(bare);
  });
});

describe("labelFilings", () => {
  it("labels each filing's latest version once and gives up on unreadable ones", async () => {
    const db = getDb();
    const fixture = await company();
    const now = new Date();
    const fresh = await filing(fixture, { deliveredOn: daysAgo(2), subject: "Dividendos" });
    const throttled = await filing(fixture, { deliveredOn: daysAgo(5) });
    const docx = await filing(fixture, { deliveredOn: daysAgo(6) });
    const old = await filing(fixture, { deliveredOn: daysAgo(120) });
    const revised = await filing(fixture, { deliveredOn: daysAgo(10) });
    await filing(fixture, { deliveredOn: daysAgo(9), protocol: revised.protocol, version: 2 });
    const fetchImpl = radFetch({
      [`${fresh.protocol}&`]: "pdf",
      [`${throttled.protocol}&`]: "html",
      [`${docx.protocol}&`]: "docx",
      [`${old.protocol}&`]: "pdf",
      [`${revised.protocol}&v=2`]: "pdf",
      [`${revised.protocol}&v=1`]: "pdf",
    });
    const { client, label } = labelClient(goodReply);
    const options = { client, cnpjs: [fixture.cnpj], fetchImpl, now, sleep: noSleep };

    const first = await labelFilings(db, { ...options, deadlineAt: deadline() });

    expect(first).toEqual({
      status: "ran",
      labelled: 2,
      rejected: 0,
      unreadable: 1,
      retryLater: 1,
      deferred: 0,
    });
    expect(label).toHaveBeenCalledTimes(2);
    expect(label.mock.calls[0]?.[0].inputs).toEqual({
      companyName: "EMPRESA TESTE S.A. - TESTE",
      category: "material_fact",
      kind: null,
      subject: "Dividendos",
      deliveredOn: daysAgo(2),
    });
    const stored = await labelsOf(fixture.protocols);
    expect(
      stored.map((row) => [row.protocol, row.version, row.outcome, row.reason, row.attempts]),
    ).toEqual(
      [
        [fresh.protocol, 1, "labelled", null, 0],
        [throttled.protocol, 1, "pending", null, 1],
        [docx.protocol, 1, "unreadable", "not_pdf", 0],
        [revised.protocol, 2, "labelled", null, 0],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    expect(stored.find((row) => row.protocol === fresh.protocol)).toMatchObject({
      topic: "dividends",
      tone: "positive",
      model: "claude-haiku-5-5",
      promptVersion: "filing-label@1",
      inputTokens: 2100,
      outputTokens: 55,
    });

    const fetchesBefore = fetchImpl.mock.calls.length;
    const sameNight = await labelFilings(db, { ...options, deadlineAt: deadline() });
    expect(sameNight).toMatchObject({ labelled: 0, unreadable: 0, retryLater: 0 });
    expect(fetchImpl.mock.calls.length).toBe(fetchesBefore);

    const nextNight = (nights: number) => new Date(now.getTime() + nights * 21 * 60 * 60 * 1000);
    await labelFilings(db, { ...options, now: nextNight(1), deadlineAt: deadline() });
    const third = await labelFilings(db, {
      ...options,
      now: nextNight(2),
      deadlineAt: deadline(),
    });

    expect(label).toHaveBeenCalledTimes(2);
    expect(third).toMatchObject({ labelled: 0, unreadable: 1, retryLater: 0 });
    const [givenUp] = await labelsOf([throttled.protocol]);
    expect(givenUp).toMatchObject({ outcome: "unreadable", reason: "unavailable", attempts: 3 });
  });

  it("stores a reply that breaks the contract as rejected and never asks again", async () => {
    const db = getDb();
    const fixture = await company();
    const target = await filing(fixture, { deliveredOn: daysAgo(1) });
    const { client, label } = labelClient(() => ({
      kind: "parsed",
      output: { topic: "results", tone: "positive", summary: "Lucro de R$ 3 bilhões." },
      model: "claude-haiku-5-5",
      usage,
    }));
    const options = {
      client,
      cnpjs: [fixture.cnpj],
      fetchImpl: radFetch({ [target.protocol]: "pdf" }),
      now: new Date(),
      sleep: noSleep,
    };

    expect(await labelFilings(db, { ...options, deadlineAt: deadline() })).toMatchObject({
      rejected: 1,
    });
    await labelFilings(db, { ...options, deadlineAt: deadline() });

    expect(label).toHaveBeenCalledTimes(1);
    const [row] = await labelsOf([target.protocol]);
    expect(row).toMatchObject({ outcome: "rejected", reason: "figure", summary: null });
  });

  it("stops at an API outage and leaves the remaining filings untouched", async () => {
    const db = getDb();
    const fixture = await company();
    await filing(fixture, { deliveredOn: daysAgo(1) });
    await filing(fixture, { deliveredOn: daysAgo(2) });
    const { client, label } = labelClient(() => ({ kind: "api_error" }));

    const outcome = await labelFilings(db, {
      client,
      cnpjs: [fixture.cnpj],
      fetchImpl: radFetch({ [fixture.cnpj]: "pdf" }),
      now: new Date(),
      deadlineAt: deadline(),
      sleep: noSleep,
    });

    expect(outcome).toMatchObject({ labelled: 0, retryLater: 2 });
    expect(label).toHaveBeenCalledTimes(1);
    expect(await labelsOf(fixture.protocols)).toEqual([]);
  });

  it("defers every filing it cannot finish before the deadline", async () => {
    const fixture = await company();
    await filing(fixture, { deliveredOn: daysAgo(1) });
    const { client, label } = labelClient(goodReply);

    const outcome = await labelFilings(getDb(), {
      client,
      cnpjs: [fixture.cnpj],
      fetchImpl: radFetch({}),
      now: new Date(),
      deadlineAt: Date.now() + 1000,
      sleep: noSleep,
    });

    expect(outcome).toMatchObject({ deferred: 1, labelled: 0 });
    expect(label).not.toHaveBeenCalled();
  });

  it("never rewrites a final label", async () => {
    const db = getDb();
    const fixture = await company();
    const key = await filing(fixture, { deliveredOn: daysAgo(1) });
    const call = {
      model: "claude-haiku-5-5",
      promptVersion: "filing-label@1",
      inputTokens: 1,
      outputTokens: 1,
    };
    await recordFinalFilingLabel(
      db,
      key,
      { outcome: "labelled", topic: "debt", tone: "neutral", summary: "Debêntures emitidas." },
      call,
    );
    await recordFinalFilingLabel(db, key, { outcome: "rejected", reason: "schema" }, call);

    const [row] = await labelsOf([key.protocol]);
    expect(row).toMatchObject({ outcome: "labelled", topic: "debt", reason: null });
  });
});

function gdeltFetch(days: readonly { day: string; tone: number; articles: number }[]) {
  const date = (day: string) => `${day.replaceAll("-", "")}T000000Z`;
  return vi.fn<typeof fetch>((input) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const volume = url.searchParams.get("mode") === "timelinevolraw";
    const data = days.map((entry) => ({
      date: date(entry.day),
      value: volume ? entry.articles : entry.tone,
    }));
    return Promise.resolve(
      new Response(
        JSON.stringify({ timeline: [{ series: volume ? "Article Count" : "Average Tone", data }] }),
      ),
    );
  });
}

describe("refreshNewsTone", () => {
  it("stores GDELT's daily tone and asks again only after a day", async () => {
    const db = getDb();
    const fixture = await company();
    const companies = [
      { cnpj: fixture.cnpj, companyName: "EMPRESA TESTE S.A. - TESTE", tickers: fixture.tickers },
    ];
    const fetchImpl = gdeltFetch([
      { day: daysAgo(2), tone: -1.5, articles: 4 },
      { day: daysAgo(1), tone: 0.5, articles: 0 },
    ]);
    const sleep = vi.fn(noSleep);

    const outcome = await refreshNewsTone(db, {
      companies,
      fetchImpl,
      now: new Date(),
      deadlineAt: deadline(),
      sleep,
    });

    expect(outcome).toEqual({ status: "ran", refreshed: 1, failed: 0, deferred: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(6000);
    const points = await db
      .select({
        day: newsTonePoints.day,
        tone: newsTonePoints.tone,
        articles: newsTonePoints.articles,
      })
      .from(newsTonePoints)
      .where(eq(newsTonePoints.cnpj, fixture.cnpj))
      .orderBy(newsTonePoints.day);
    expect(points).toEqual([
      { day: daysAgo(2), tone: "-1.5000", articles: 4 },
      { day: daysAgo(1), tone: "0.0000", articles: 0 },
    ]);
    const [fetchRow] = await db
      .select()
      .from(sentimentFetches)
      .where(and(eq(sentimentFetches.source, "gdelt"), eq(sentimentFetches.subject, fixture.cnpj)));
    expect(fetchRow?.status).toBe("ok");
    expect(fetchRow?.query).toContain('"teste"');

    await refreshNewsTone(db, {
      companies,
      fetchImpl,
      now: new Date(),
      deadlineAt: deadline(),
      sleep,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("leaves the company due when GDELT asks to slow down", async () => {
    const db = getDb();
    const fixture = await company();
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("Please limit requests to one every 5 seconds")),
    );
    const options = {
      companies: [{ cnpj: fixture.cnpj, companyName: null, tickers: fixture.tickers }],
      fetchImpl,
      now: new Date(),
      sleep: noSleep,
    };

    const outcome = await refreshNewsTone(db, { ...options, deadlineAt: deadline() });

    expect(outcome).toEqual({ status: "rate_limited", refreshed: 0, failed: 0, deferred: 1 });
    const [row] = await db
      .select()
      .from(sentimentFetches)
      .where(eq(sentimentFetches.subject, fixture.cnpj));
    expect(row?.status).toBe("rate_limited");
    await refreshNewsTone(db, { ...options, deadlineAt: deadline() });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

function fakeProvider(articles: (ticker: string) => ProviderArticle[]) {
  const latestArticles = vi.fn<NewsSentimentProvider["latestArticles"]>((tickers) =>
    Promise.resolve({ kind: "ok", articles: tickers.flatMap(articles) }),
  );
  return {
    provider: { name: "marketaux", latestArticles } satisfies NewsSentimentProvider,
    latestArticles,
  };
}

function article(ticker: string, id: string, sentiment: string): ProviderArticle {
  return {
    articleId: id,
    ticker,
    title: `Notícia ${id}`,
    url: `https://example.com/${id}`,
    source: "example.com",
    publishedAt: new Date(Date.now() - DAY_MS),
    sentiment: sentiment as ProviderArticle["sentiment"],
  };
}

describe("refreshProviderArticles", () => {
  it("is off without a provider", async () => {
    expect(
      await refreshProviderArticles(getDb(), {
        provider: null,
        tickers: ["PETR4"],
        now: new Date(),
        deadlineAt: deadline(),
      }),
    ).toEqual({ status: "off", refreshed: 0, articles: 0, failed: 0, deferred: 0 });
  });

  it("stores each ticker's articles once and asks again only after a day", async () => {
    const db = getDb();
    const fixture = await company();
    const { provider, latestArticles } = fakeProvider((ticker) => [
      article(ticker, `${ticker}-a`, "0.6124"),
    ]);
    const options = { provider, tickers: fixture.tickers, deadlineAt: deadline() };

    const outcome = await refreshProviderArticles(db, { ...options, now: new Date() });

    expect(outcome).toEqual({ status: "ran", refreshed: 2, articles: 2, failed: 0, deferred: 0 });
    expect(latestArticles.mock.calls.map((call) => call[0])).toEqual(
      fixture.tickers.map((t) => [t]),
    );
    await refreshProviderArticles(db, { ...options, now: new Date() });
    expect(latestArticles).toHaveBeenCalledTimes(2);

    const later = await refreshProviderArticles(db, {
      ...options,
      now: new Date(Date.now() + 21 * 60 * 60 * 1000),
    });
    expect(later).toMatchObject({ refreshed: 2, articles: 0 });
  });
});

describe("sentimentForInstrument", () => {
  it("shows the stored labels, news tone and articles of the ticker's company", async () => {
    const db = getDb();
    const fixture = await company();
    const [ticker = ""] = fixture.tickers;
    const labelled = await filing(fixture, { deliveredOn: daysAgo(3) });
    await filing(fixture, { deliveredOn: daysAgo(4) });
    await recordFinalFilingLabel(
      db,
      labelled,
      { outcome: "labelled", topic: "buyback", tone: "positive", summary: "Recompra aprovada." },
      null,
    );
    await refreshNewsTone(db, {
      companies: [{ cnpj: fixture.cnpj, companyName: null, tickers: fixture.tickers }],
      fetchImpl: gdeltFetch([
        { day: daysAgo(40), tone: 9, articles: 50 },
        { day: daysAgo(5), tone: -2, articles: 1 },
        { day: daysAgo(4), tone: 1, articles: 3 },
      ]),
      now: new Date(),
      deadlineAt: deadline(),
      sleep: noSleep,
    });
    await refreshProviderArticles(db, {
      provider: fakeProvider((t) => [article(t, `${t}-x`, "-0.2500")]).provider,
      tickers: [ticker],
      now: new Date(),
      deadlineAt: deadline(),
    });

    const view = await sentimentForInstrument(db, ticker);

    expect(view.mapped).toBe(true);
    expect(view.filings).toEqual({
      enabled: false,
      counts: { positive: 1, neutral: 0, negative: 0 },
      labelled: 1,
      waiting: 1,
      unlabelled: 0,
      latest: [
        {
          protocol: labelled.protocol,
          deliveredOn: daysAgo(3),
          category: "material_fact",
          documentUrl: labelled.documentUrl,
          topic: "buyback",
          tone: "positive",
          summary: "Recompra aprovada.",
        },
      ],
    });
    expect(view.newsTone).toMatchObject({
      status: "ok",
      average: { tone: "0.2500", articles: 4 },
    });
    expect(view.newsTone.points).toHaveLength(3);
    expect(view.provider.articles).toEqual([
      expect.objectContaining({ ticker, articleId: `${ticker}-x`, sentiment: "-0.2500" }),
    ]);
  });

  it("with knownAt shows only what was known by then: earlier filings, tone days and articles (docs/adr/0076)", async () => {
    const db = getDb();
    const fixture = await company();
    const [ticker = ""] = fixture.tickers;
    const knownAt = new Date(Date.now() - 5 * DAY_MS);
    const known = await filing(fixture, { deliveredOn: daysAgo(8) });
    const sameDay = await filing(fixture, { deliveredOn: todaySaoPauloDate(knownAt) });
    const later = await filing(fixture, { deliveredOn: daysAgo(2) });
    const refiled = await filing(fixture, {
      deliveredOn: daysAgo(1),
      protocol: known.protocol,
      version: 2,
    });
    for (const [stored, summary] of [
      [known, "Conhecido."],
      [sameDay, "No mesmo dia."],
      [later, "Depois."],
      [refiled, "Reapresentado."],
    ] as const) {
      await recordFinalFilingLabel(
        db,
        stored,
        { outcome: "labelled", topic: "buyback", tone: "positive", summary },
        null,
      );
    }
    await refreshNewsTone(db, {
      companies: [{ cnpj: fixture.cnpj, companyName: null, tickers: fixture.tickers }],
      fetchImpl: gdeltFetch([
        { day: daysAgo(9), tone: 1, articles: 2 },
        { day: todaySaoPauloDate(knownAt), tone: -4, articles: 10 },
        { day: daysAgo(2), tone: -6, articles: 10 },
      ]),
      now: new Date(),
      deadlineAt: deadline(),
      sleep: noSleep,
    });
    await insertNewsArticles(
      db,
      [
        ["before", new Date(knownAt.getTime() - 60_000)],
        ["after", new Date(knownAt.getTime() + 60_000)],
      ].map(([id, publishedAt]) => ({
        provider: "marketaux" as const,
        articleId: `${ticker}-${String(id)}`,
        ticker,
        title: `Notícia ${String(id)}`,
        url: `https://example.com/${ticker}-${String(id)}`,
        source: "example.com",
        publishedAt: publishedAt as Date,
        sentiment: "0.1000" as DecimalString,
      })),
    );

    const view = await sentimentForInstrument(db, ticker, new Date(), knownAt);

    expect(view.filings.latest.map((entry) => entry.summary)).toEqual(["Conhecido."]);
    expect(view.newsTone.points.map((point) => point.day)).toEqual([daysAgo(9)]);
    expect(view.newsTone.average).toEqual({ tone: "1.0000", articles: 2 });
    expect(view.provider.articles.map((entry) => entry.articleId)).toEqual([`${ticker}-before`]);
  });

  it("says a code with no listed company is not mapped", async () => {
    const view = await sentimentForInstrument(getDb(), `${randomLetters(4)}11`);
    expect(view).toMatchObject({ mapped: false, newsTone: { points: [], average: null } });
  });
});

describe("runSentimentJob", () => {
  it("runs the three sources for the watched companies and reports each one", async () => {
    const db = getDb();
    const fixture = await company(1);
    await watch(fixture, fixture.tickers);
    const target = await filing(fixture, { deliveredOn: daysAgo(1) });
    const gdelt = gdeltFetch([{ day: daysAgo(1), tone: 1, articles: 2 }]);
    const rad = radFetch({ [target.protocol]: "pdf" });
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return url.includes("gdeltproject") ? gdelt(input, init) : rad(input, init);
    });
    const { client } = labelClient(goodReply);
    const { provider } = fakeProvider(() => []);

    const outcome = await runSentimentJob(db, {
      deadlineAt: deadline(),
      fetchImpl,
      labelClient: client,
      provider,
      sleep: noSleep,
    });

    expect(outcome.labels).toMatchObject({ status: "ran" });
    expect(outcome.labels.labelled).toBeGreaterThanOrEqual(1);
    expect(outcome.newsTone).toMatchObject({ status: "ran" });
    expect(outcome.provider).toMatchObject({ status: "ran" });
    const [row] = await labelsOf([target.protocol]);
    expect(row).toMatchObject({ outcome: "labelled" });
  });

  it("keeps labels off by default, with no Anthropic call", async () => {
    const outcome = await runSentimentJob(getDb(), {
      deadlineAt: Date.now() + 1000,
      fetchImpl: vi.fn<typeof fetch>(() => Promise.reject(new Error("offline"))),
      provider: null,
      sleep: noSleep,
    });
    expect(outcome.labels.status).toBe("off");
    expect(outcome.provider.status).toBe("off");
  });
});
