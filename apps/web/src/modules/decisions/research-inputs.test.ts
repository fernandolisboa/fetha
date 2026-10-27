import { describe, expect, it } from "vitest";
import {
  analysisInputsSchema,
  centavosSchema,
  decimalStringSchema,
  MAX_RESEARCH_IDEAS_SENT,
  sessionDateSchema,
  tickerSchema,
  type Centavos,
} from "@fetha/contracts";
import type { AssetReading, OperationPricing } from "@fetha/engine";

import type { Idea, SuggestionCalibration } from "@/modules/radar";
import type { SentimentView } from "@/modules/sentiment";

import { buildResearchInputs, ideaContextOf, selectIdeasToSend } from "./research-inputs";

const session = (value: string) => sessionDateSchema.parse(value);
const decimal = (value: string) => decimalStringSchema.parse(value);

const label = (value: string) => ({ label: value });
const reading = {
  trend: label("up"),
  momentum: label("neutral"),
  range: label("calm"),
  impliedVolatility: label("low"),
  options: { label: "liquid", tradedSeries: 30 },
} as unknown as AssetReading;

const pricing = {
  at: "2026-10-23T18:00:00.000Z",
  underlying: "PETR4",
  spot: "38.50",
  riskFreeRate: "0.1065",
  dividendYield: "0",
  legs: [
    {
      leg: { role: "call", side: "buy", ticker: "PETRK385", quantity: 100 },
      price: "1.20",
      priceSource: "close",
      stale: null,
      fairValue: null,
      impliedVolatility: null,
      greeks: null,
    },
  ],
  netPremium: -12000,
  greeks: { delta: "18.4", gamma: "2.1", theta: "-0.85", vega: "3.2", rho: "1.05" },
  payoff: [
    { underlying: "36.00", pnl: -12000 },
    { underlying: "40.00", pnl: 8000 },
  ],
  breakEvens: ["39.70"],
  maxLoss: 12000,
  maxGain: 8000,
  limitBreaches: [],
  notes: [],
} as unknown as OperationPricing;

function idea(overrides: Partial<Idea> = {}): Idea {
  return {
    underlying: tickerSchema.parse("PETR4"),
    recipeId: "bull-call-spread-low-iv",
    structure: { id: "bull-call-spread", name: "Trava de alta com calls" },
    foundOn: session("2026-10-21"),
    expiry: session("2026-11-20"),
    sessionsToExpiry: 20,
    legs: [],
    netPremium: centavosSchema.parse(-12000),
    maxLoss: centavosSchema.parse(12000),
    maxGain: centavosSchema.parse(8000),
    breakEvens: [decimal("39.70")],
    reading,
    alerts: [],
    suggestionId: "suggestion-secret-id",
    pricing,
    ...overrides,
  };
}

const noCalibration: SuggestionCalibration = {
  overall: {
    recipeId: null,
    recipeName: null,
    scored: 0,
    claimed: 0,
    held: 0,
    pnl: centavosSchema.parse(0),
  },
  byRecipe: [],
};

function calibrationOf(scored: number, claimed: number, held: number, pnl: Centavos) {
  return {
    ...noCalibration,
    byRecipe: [
      { recipeId: "bull-call-spread-low-iv", recipeName: "x", scored, claimed, held, pnl },
    ],
  };
}

const mappedSentiment = (overrides: Partial<SentimentView["filings"]> = {}): SentimentView =>
  ({
    mapped: true,
    filings: {
      enabled: true,
      counts: { positive: 1, neutral: 0, negative: 0 },
      labelled: 1,
      waiting: 0,
      unlabelled: 0,
      latest: [
        {
          protocol: "p1",
          deliveredOn: "2026-10-20",
          category: "fato_relevante",
          documentUrl: "https://example.test/doc",
          topic: "guidance",
          tone: "positive",
          summary: "A empresa elevou a projeção de produção.",
        },
      ],
      ...overrides,
    },
    newsTone: {
      query: "petrobras",
      status: "ok",
      fetchedAt: new Date("2026-10-23T10:00:00Z"),
      points: [],
      average: { tone: decimal("-1.2345"), articles: 40 },
    },
    provider: {
      enabled: true,
      articles: [
        {
          provider: "marketaux",
          articleId: "a1",
          ticker: "PETR4",
          title: "Petrobras anuncia novo poço",
          url: "https://example.test/a1",
          source: "example",
          publishedAt: new Date("2026-10-22T12:00:00Z"),
          sentiment: decimal("0.35"),
        },
      ],
    },
  }) as unknown as SentimentView;

describe("selectIdeasToSend", () => {
  it("sends holding ideas first, then no longer holding, in the engine's order, up to the cut", () => {
    const holding = Array.from({ length: 12 }, (_, index) =>
      idea({ underlying: tickerSchema.parse(`HOLD${String(index)}`) }),
    );
    const gone = Array.from({ length: 13 }, (_, index) =>
      idea({ underlying: tickerSchema.parse(`GONE${String(index)}`) }),
    );
    const { sent, unsent } = selectIdeasToSend({ holding, noLongerHolding: gone });
    expect(sent).toHaveLength(MAX_RESEARCH_IDEAS_SENT);
    expect(sent.slice(0, 12)).toEqual(holding);
    expect(sent.slice(12)).toEqual(gone.slice(0, 8));
    expect(unsent).toEqual(gone.slice(8));
  });

  it("sends nothing when the engine found nothing", () => {
    expect(selectIdeasToSend({ holding: [], noLongerHolding: [] })).toEqual({
      sent: [],
      unsent: [],
    });
  });
});

describe("ideaContextOf", () => {
  it("has no track record when the recipe was never scored", () => {
    expect(ideaContextOf(idea(), noCalibration, null).trackRecord).toBeNull();
    expect(
      ideaContextOf(idea(), calibrationOf(0, 0, 0, centavosSchema.parse(0)), null).trackRecord,
    ).toBeNull();
  });

  it("carries the recipe's shared calibration", () => {
    expect(
      ideaContextOf(idea(), calibrationOf(5, 4, 3, centavosSchema.parse(-2500)), null).trackRecord,
    ).toEqual({ claimed: 4, held: 3, scored: 5, averagePnl: -500 });
  });

  it("sends no filings, tone or news for an underlying the sentiment data does not cover", () => {
    const empty = { trackRecord: null, filings: [], newsTone: null, providerNews: [] };
    expect(ideaContextOf(idea(), noCalibration, null)).toEqual(empty);
    expect(
      ideaContextOf(idea(), noCalibration, {
        mapped: false,
        provider: { enabled: false, articles: [] },
      } as unknown as SentimentView),
    ).toEqual(empty);
  });

  it("keeps the provider's articles for a ticker with no mapped company, and nothing else", () => {
    const unmapped = { ...mappedSentiment(), mapped: false } as SentimentView;
    expect(ideaContextOf(idea(), noCalibration, unmapped)).toEqual({
      trackRecord: null,
      filings: [],
      newsTone: null,
      providerNews: [
        { publishedOn: "2026-10-22", title: "Petrobras anuncia novo poço", sentiment: "0.35" },
      ],
    });
  });

  it("dates an article by its São Paulo day, not its UTC one", () => {
    const sentiment = mappedSentiment();
    const [article] = sentiment.provider.articles;
    if (!article) throw new Error("fixture");
    article.publishedAt = new Date("2026-10-23T01:30:00Z");
    expect(ideaContextOf(idea(), noCalibration, sentiment).providerNews[0]?.publishedOn).toBe(
      "2026-10-22",
    );
  });

  it("carries the labelled filings, the news tone and the provider's articles that exist", () => {
    const context = ideaContextOf(idea(), noCalibration, mappedSentiment());
    expect(context.filings).toEqual([
      {
        deliveredOn: "2026-10-20",
        topic: "guidance",
        tone: "positive",
        summary: "A empresa elevou a projeção de produção.",
      },
    ]);
    expect(context.newsTone).toEqual({ tone: "-1.2345", articles: 40, windowDays: 30 });
    expect(context.providerNews).toEqual([
      { publishedOn: "2026-10-22", title: "Petrobras anuncia novo poço", sentiment: "0.35" },
    ]);
  });

  it("sends no tone when GDELT has no article in the window", () => {
    const sentiment = mappedSentiment();
    sentiment.newsTone.average = null;
    expect(ideaContextOf(idea(), noCalibration, sentiment).newsTone).toBeNull();
  });
});

describe("buildResearchInputs", () => {
  const none = () => ({ trackRecord: null, filings: [], newsTone: null, providerNews: [] });

  it("builds inputs that pass the schema, one entry per idea in the order given", () => {
    const built = buildResearchInputs({
      newestClose: session("2026-10-23"),
      ideas: [idea(), idea({ underlying: tickerSchema.parse("VALE3") })],
      context: none,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(analysisInputsSchema.safeParse(built.inputs).success).toBe(true);
    expect(built.inputs.subject).toBe("research");
    const facts = built.inputs.facts as { newestClose: string; ideas: { underlying: string }[] };
    expect(facts.newestClose).toBe("23/10/2026");
    expect(facts.ideas.map((entry) => entry.underlying)).toEqual(["PETR4", "VALE3"]);
  });

  it("names a breached limit but never its value, the capital behind it or any id", () => {
    const built = buildResearchInputs({
      newestClose: session("2026-10-23"),
      ideas: [
        idea({
          alerts: [
            { kind: "rule_no_longer_holds", foundOn: session("2026-10-21") },
            {
              kind: "limit_breach",
              breach: {
                limit: "maxLossPerOperation",
                value: decimal("0.8765"),
                allowed: decimal("0.5432"),
              },
            },
            { kind: "near_expiry", sessionsLeft: 3 },
          ],
        }),
      ],
      context: none,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const sent = JSON.stringify(built.inputs);
    const [first] = (built.inputs.facts as { ideas: Record<string, unknown>[] }).ideas;
    expect(first?.engineAlerts).toEqual([
      "rule_no_longer_holds",
      "limit_breach:maxLossPerOperation",
      "near_expiry",
    ]);
    expect(first?.ruleHolds).toBe("no");
    for (const absent of ["8765", "5432", "declaredCapital", "suggestion-secret-id"]) {
      expect(sent).not.toContain(absent);
    }
  });

  it("says the rule still holds when no alert says otherwise", () => {
    const built = buildResearchInputs({
      newestClose: session("2026-10-23"),
      ideas: [idea()],
      context: none,
    });
    expect(
      built.ok && (built.inputs.facts as { ideas: { ruleHolds: string }[] }).ideas[0]?.ruleHolds,
    ).toBe("yes");
  });

  it("writes the recipe's own move, volatility regime and rules", () => {
    const built = buildResearchInputs({
      newestClose: session("2026-10-23"),
      ideas: [idea()],
      context: none,
    });
    if (!built.ok) throw new Error("expected inputs");
    const [first] = (built.inputs.facts as { ideas: { recipe: Record<string, unknown> }[] }).ideas;
    expect(first?.recipe).toMatchObject({ expectedMove: "up", ivRegime: "low" });
    expect(first?.recipe.entry).not.toBeNull();
  });

  it("thins each idea's payoff to the research's cap", () => {
    const wide = {
      ...pricing,
      payoff: Array.from({ length: 50 }, (_, index) => ({
        underlying: `${String(30 + index)}.00`,
        pnl: index * 100,
      })),
    } as unknown as OperationPricing;
    const built = buildResearchInputs({
      newestClose: session("2026-10-23"),
      ideas: [idea({ pricing: wide })],
      context: none,
    });
    if (!built.ok) throw new Error("expected inputs");
    const [first] = (built.inputs.facts as { ideas: { pricing: { payoff: unknown[] } }[] }).ideas;
    expect(first?.pricing.payoff).toHaveLength(9);
  });

  it("clips a long filing summary and news title to the fact limit", () => {
    const long = "x".repeat(500);
    const built = buildResearchInputs({
      newestClose: session("2026-10-23"),
      ideas: [idea()],
      context: () => ({
        trackRecord: null,
        filings: [
          {
            deliveredOn: session("2026-10-20"),
            topic: "guidance",
            tone: "positive",
            summary: long,
          },
        ],
        newsTone: null,
        providerNews: [
          { publishedOn: session("2026-10-22"), title: long, sentiment: decimal("0.1") },
        ],
      }),
    });
    if (!built.ok) throw new Error("expected inputs");
    const [first] = (
      built.inputs.facts as {
        ideas: { filings: { summary: string }[]; providerNews: { title: string }[] }[];
      }
    ).ideas;
    expect(first?.filings[0]?.summary.length).toBeLessThanOrEqual(200);
    expect(first?.providerNews[0]?.title.length).toBeLessThanOrEqual(200);
  });

  it("writes the track record, filings and news as display strings, and null when there are none", () => {
    const built = buildResearchInputs({
      newestClose: session("2026-10-23"),
      ideas: [idea(), idea({ underlying: tickerSchema.parse("VALE3") })],
      context: (entry) =>
        entry.underlying === "PETR4"
          ? ideaContextOf(
              entry,
              calibrationOf(8, 4, 3, centavosSchema.parse(-2400)),
              mappedSentiment(),
            )
          : none(),
    });
    if (!built.ok) throw new Error("expected inputs");
    const [rich, bare] = (built.inputs.facts as { ideas: Record<string, unknown>[] }).ideas;
    expect(rich?.recipeTrackRecord).toEqual({
      scored: "8",
      claimHeldShare: "75%",
      pnlPerLot: "−R$ 3,00",
    });
    expect(rich?.filings).toEqual([
      {
        date: "20/10/2026",
        topic: "guidance",
        tone: "positive",
        summary: "A empresa elevou a projeção de produção.",
      },
    ]);
    expect(rich?.newsTone).toEqual({ averageTone: "−1,23", articles: "40", window: "30 dias" });
    expect(rich?.providerNews).toEqual([
      { date: "22/10/2026", title: "Petrobras anuncia novo poço", sentiment: "0,35" },
    ]);
    expect(bare).toMatchObject({
      recipeTrackRecord: null,
      filings: null,
      newsTone: null,
      providerNews: null,
    });
  });

  it("is not ready when the facts break the schema", () => {
    const crowded = {
      ...pricing,
      legs: Array.from({ length: 61 }, () => pricing.legs[0]),
    } as unknown as OperationPricing;
    expect(
      buildResearchInputs({
        newestClose: session("2026-10-23"),
        ideas: [idea({ pricing: crowded })],
        context: none,
      }),
    ).toEqual({ ok: false });
  });
});
