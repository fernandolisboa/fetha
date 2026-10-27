import { describe, expect, it, vi, type Mock } from "vitest";
import {
  centavosSchema,
  decimalStringSchema,
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
  type AnalysisInputs,
  type ResearchOutput,
} from "@fetha/contracts";
import type { AssetReading, OperationPricing } from "@fetha/engine";

import type { Idea } from "@/modules/radar";

import { AnalysisCapReachedError } from "./analyses-repository";
import type { AnalysisModelReply } from "./analysis-model";
import {
  requestResearch,
  type RequestResearchDeps,
  type RequestResearchInput,
} from "./research-service";

const session = (value: string) => sessionDateSchema.parse(value);

const NEWEST_CLOSE = session("2026-10-23");
const REQUESTED_AT = new Date("2026-10-24T15:00:00Z");

const pricing = {
  underlying: "PETR4",
  spot: "38.50",
  legs: [],
  netPremium: -12000,
  breakEvens: ["39.70"],
  payoff: [
    { underlying: "36.00", pnl: -12000 },
    { underlying: "42.00", pnl: 8000 },
  ],
  maxLoss: 12000,
  maxGain: 8000,
} as unknown as OperationPricing;

function idea(ticker: string): Idea {
  return {
    underlying: tickerSchema.parse(ticker),
    recipeId: "bull-call-spread-low-iv",
    structure: { id: "bull-call-spread", name: "Trava de alta com calls" },
    foundOn: session("2026-10-21"),
    expiry: session("2026-11-20"),
    sessionsToExpiry: 20,
    legs: [
      {
        role: "call",
        side: "buy",
        ticker: tickerSchema.parse(`${ticker.slice(0, 4)}K385`),
        strike: decimalStringSchema.parse("38.5"),
        expiry: session("2026-11-20"),
        quantity: quantitySchema.parse(100),
        price: decimalStringSchema.parse("1.20"),
      },
    ],
    netPremium: centavosSchema.parse(-12000),
    maxLoss: centavosSchema.parse(12000),
    maxGain: centavosSchema.parse(8000),
    breakEvens: [decimalStringSchema.parse("39.70")],
    reading: {} as AssetReading,
    alerts: [],
    suggestionId: null,
    pricing,
  };
}

const inputs: AnalysisInputs = {
  subject: "research",
  facts: {
    newestClose: "23/10/2026",
    ideas: [
      { underlying: "PETR4", pricing: { maxLoss: "R$ 120,00", breakEvens: ["R$ 39,70"] } },
      { underlying: "VALE3", pricing: { maxLoss: "R$ 120,00", breakEvens: ["R$ 39,70"] } },
    ],
  },
};

const answer = (position: number, verdict: ResearchOutput["ideas"][number]["verdict"]) => ({
  idea: `ideas.${String(position)}`,
  verdict,
  justification: "A perda máxima é de R$ 120,00.",
  alerts: [],
  inputsCited: [`ideas.${String(position)}.pricing.maxLoss`],
});

const goodOutput: ResearchOutput = {
  overview: "Duas ideias, ambas com perda máxima de R$ 120,00.",
  ideas: [answer(0, "enter"), answer(1, "do_not_enter")],
};

const usage = { inputTokens: 1000, outputTokens: 300 };

function clientReplying(output: unknown): { analyze: Mock } {
  const reply: AnalysisModelReply = {
    kind: "parsed",
    output,
    model: "claude-opus-5-5",
    usage,
  };
  return { analyze: vi.fn().mockResolvedValue(reply) };
}

const containing = (value: Record<string, unknown>): unknown => expect.objectContaining(value);

function deps(overrides: Partial<RequestResearchDeps> = {}): RequestResearchDeps {
  return {
    db: {} as RequestResearchDeps["db"],
    user: { id: "user-1" },
    model: "claude-opus-5-5",
    family: "opus",
    client: clientReplying(goodOutput),
    assemble: vi.fn().mockResolvedValue({ ok: true, inputs }),
    repository: {
      reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
      complete: vi.fn(),
    },
    store: { storeAccepted: vi.fn() },
    newId: () => "research-1",
    ...overrides,
  };
}

const request: RequestResearchInput = {
  newestClose: NEWEST_CLOSE,
  sessionsLooked: 3,
  candidates: 16,
  dropped: { unpriced: 0, expires_too_soon: 1, exceeds_capital: 0, not_evaluable: 2 },
  usingDefaultProfile: true,
  ideas: [idea("PETR4"), idea("VALE3")],
};

describe("requestResearch", () => {
  it("is unavailable, with nothing assembled or reserved, when there is no client", async () => {
    const assemble = vi.fn();
    const reserve = vi.fn();
    const result = await requestResearch(
      deps({ client: null, assemble, repository: { reserve, complete: vi.fn() } }),
      request,
    );
    expect(result).toEqual({ status: "unavailable" });
    expect(assemble).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("reserves and calls nothing when assembling the facts left too little time", async () => {
    const reserve = vi.fn();
    const client = clientReplying(goodOutput);
    const result = await requestResearch(
      deps({
        client,
        mustStartBy: 100,
        clock: () => 101,
        repository: { reserve, complete: vi.fn() },
      }),
      request,
    );
    expect(result).toEqual({ status: "failed" });
    expect(reserve).not.toHaveBeenCalled();
    expect(client.analyze).not.toHaveBeenCalled();
  });

  it("lets an error assembling the facts out, with nothing reserved", async () => {
    const reserve = vi.fn();
    await expect(
      requestResearch(
        deps({
          assemble: vi.fn().mockRejectedValue(new Error("neon unreachable")),
          repository: { reserve, complete: vi.fn() },
        }),
        request,
      ),
    ).rejects.toThrow("neon unreachable");
    expect(reserve).not.toHaveBeenCalled();
  });

  it("calls no model and reserves nothing when there are no ideas", async () => {
    const reserve = vi.fn();
    const client = clientReplying(goodOutput);
    const result = await requestResearch(
      deps({ client, repository: { reserve, complete: vi.fn() } }),
      { ...request, ideas: [] },
    );
    expect(result).toEqual({ status: "not_ready" });
    expect(reserve).not.toHaveBeenCalled();
    expect(client.analyze).not.toHaveBeenCalled();
  });

  it("is not ready, reserving nothing, when the facts cannot be assembled", async () => {
    const reserve = vi.fn();
    const result = await requestResearch(
      deps({
        assemble: vi.fn().mockResolvedValue({ ok: false }),
        repository: { reserve, complete: vi.fn() },
      }),
      request,
    );
    expect(result).toEqual({ status: "not_ready" });
    expect(reserve).not.toHaveBeenCalled();
  });

  it("answers cap_reached when the monthly cap is used", async () => {
    const result = await requestResearch(
      deps({
        repository: {
          reserve: vi.fn().mockRejectedValue(new AnalysisCapReachedError()),
          complete: vi.fn(),
        },
      }),
      request,
    );
    expect(result).toEqual({ status: "cap_reached" });
  });

  it("asks the model once, with the research prompt, and reserves one analysis for the research", async () => {
    const client = clientReplying(goodOutput);
    const reserve = vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT });
    await requestResearch(deps({ client, repository: { reserve, complete: vi.fn() } }), request);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectKind: "research",
        subjectId: "research-1",
        promptVersion: "research@1",
        inputs,
      }),
    );
    expect(client.analyze).toHaveBeenCalledTimes(1);
  });

  it("stores an accepted research with each idea's verdict, claim and horizon, in order", async () => {
    const storeAccepted = vi.fn();
    const result = await requestResearch(deps({ store: { storeAccepted } }), request);
    expect(result).toEqual({ status: "accepted", researchId: "research-1" });
    expect(storeAccepted).toHaveBeenCalledTimes(1);
    const [stored] = storeAccepted.mock.calls[0] as [
      {
        completion: { outcome: string; reason: unknown; claim: unknown; model: string };
        research: Record<string, unknown>;
        ideas: Record<string, unknown>[];
      },
    ];
    expect(stored.completion).toMatchObject({
      outcome: "accepted",
      reason: null,
      claim: null,
      model: "claude-opus-5-5",
    });
    expect(stored.research).toEqual({
      id: "research-1",
      analysisRequestId: "req-1",
      newestClose: NEWEST_CLOSE,
      sessionsLooked: 3,
      candidates: 16,
      dropped: request.dropped,
      usingDefaultProfile: true,
    });
    expect(stored.ideas.map((entry) => [entry.position, entry.underlying, entry.verdict])).toEqual([
      [0, "PETR4", "enter"],
      [1, "VALE3", "do_not_enter"],
    ]);
    expect(stored.ideas[0]).toMatchObject({
      horizon: "2026-11-20",
      claim: { kind: "close_above", instrument: "PETR4", level: "39.70" },
      inputsCited: ["ideas.0.pricing.maxLoss"],
    });
  });

  it("puts the ideas in the engine's order even when the model answers them out of order", async () => {
    const storeAccepted = vi.fn();
    await requestResearch(
      deps({
        client: clientReplying({
          ...goodOutput,
          ideas: [answer(1, "wait"), answer(0, "enter")],
        }),
        store: { storeAccepted },
      }),
      request,
    );
    const [stored] = storeAccepted.mock.calls[0] as [{ ideas: { position: number }[] }];
    expect(stored.ideas.map((entry) => entry.position)).toEqual([0, 1]);
  });

  it.each([
    ["skips an idea", [answer(0, "enter")], "missing"],
    ["answers one twice", [answer(0, "enter"), answer(0, "wait"), answer(1, "wait")], "duplicate"],
    ["answers an idea it was not given", [answer(0, "enter"), answer(7, "wait")], "unknown"],
  ] as const)(
    "rejects a reply that %s, stores nothing but the result and counts it",
    async (_, ideas, problem) => {
      const complete = vi.fn();
      const storeAccepted = vi.fn();
      const result = await requestResearch(
        deps({
          client: clientReplying({ ...goodOutput, ideas }),
          repository: {
            reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
            complete,
          },
          store: { storeAccepted },
        }),
        request,
      );
      expect(result).toEqual({ status: "rejected" });
      expect(storeAccepted).not.toHaveBeenCalled();
      expect(complete).toHaveBeenCalledWith(
        "req-1",
        expect.objectContaining({
          outcome: "rejected",
          reason: { kind: "research_ideas", problem },
          output: null,
        }),
      );
    },
  );

  it("rejects a justification that writes a figure the facts do not hold", async () => {
    const complete = vi.fn();
    const storeAccepted = vi.fn();
    const result = await requestResearch(
      deps({
        client: clientReplying({
          ...goodOutput,
          ideas: [
            { ...answer(0, "enter"), justification: "O ganho chega a R$ 999,00." },
            answer(1, "wait"),
          ],
        }),
        repository: {
          reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
          complete,
        },
        store: { storeAccepted },
      }),
      request,
    );
    expect(result).toEqual({ status: "rejected" });
    expect(storeAccepted).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith(
      "req-1",
      expect.objectContaining({
        reason: containing({ kind: "citation", uncitedFigures: ["999,00"] }),
      }),
    );
  });

  it("rejects a citation of a path the facts do not hold", async () => {
    const complete = vi.fn();
    const result = await requestResearch(
      deps({
        client: clientReplying({
          ...goodOutput,
          ideas: [
            { ...answer(0, "enter"), inputsCited: ["ideas.0.pricing.nothing"] },
            answer(1, "wait"),
          ],
        }),
        repository: {
          reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
          complete,
        },
      }),
      request,
    );
    expect(result).toEqual({ status: "rejected" });
    expect(complete).toHaveBeenCalledWith(
      "req-1",
      expect.objectContaining({
        reason: containing({ unknownPaths: ["ideas.0.pricing.nothing"] }),
      }),
    );
  });

  it("rejects an alert outside the closed list as a schema failure", async () => {
    const complete = vi.fn();
    const result = await requestResearch(
      deps({
        client: clientReplying({
          ...goodOutput,
          ideas: [{ ...answer(0, "enter"), alerts: ["too_good_to_be_true"] }, answer(1, "wait")],
        }),
        repository: {
          reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
          complete,
        },
      }),
      request,
    );
    expect(result).toEqual({ status: "rejected" });
    expect(complete).toHaveBeenCalledWith(
      "req-1",
      expect.objectContaining({ reason: { kind: "schema" } }),
    );
  });

  it("settles a reply it could not store as rejected, so it still counts", async () => {
    const complete = vi.fn();
    const result = await requestResearch(
      deps({
        repository: {
          reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
          complete,
        },
        store: { storeAccepted: vi.fn().mockRejectedValue(new Error("boom")) },
      }),
      request,
    );
    expect(result).toEqual({ status: "rejected" });
    expect(complete).toHaveBeenCalledWith(
      "req-1",
      expect.objectContaining({ outcome: "rejected", reason: { kind: "storage" } }),
    );
  });

  it("fails, without counting, when the API gives no reply", async () => {
    const complete = vi.fn();
    const result = await requestResearch(
      deps({
        client: { analyze: vi.fn().mockResolvedValue({ kind: "api_error", status: 529 }) },
        repository: {
          reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
          complete,
        },
      }),
      request,
    );
    expect(result).toEqual({ status: "failed" });
    expect(complete).toHaveBeenCalledWith(
      "req-1",
      expect.objectContaining({ outcome: "failed", reason: { kind: "api_error", status: 529 } }),
    );
  });
});
