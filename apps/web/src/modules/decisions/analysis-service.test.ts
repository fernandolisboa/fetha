import { describe, expect, it, vi } from "vitest";
import type { AnalysisInputs, AnalysisOutputV3 } from "@fetha/contracts";

import type { AnalysisModelClient, AnalysisModelReply } from "./analysis-model";
import { requestAnalysis, type RequestAnalysisDeps } from "./analysis-service";

const inputs: AnalysisInputs = {
  subject: "signal",
  facts: {
    session: "09/10/2026",
    kind: "entry",
    ticker: "VALE3",
    timeframe: "D1",
    indicators: [],
    rule: null,
    proposal: { pricing: { spot: "R$ 59,10", breakEvens: ["R$ 59,10"] } },
  },
};

const REQUESTED_AT = new Date("2026-10-10T15:00:00Z");

const acceptedOutput: AnalysisOutputV3 = {
  thesis: "O sinal aponta para VALE3 na sessão de 09/10/2026.",
  counterThesis: "Sem indicadores, a leitura é frágil.",
  keyRisks: ["Risco de mercado"],
  maxLoss: "Os fatos não trazem um valor de perda máxima.",
  breakEvens: "Os fatos não trazem break-evens.",
  invalidation: ["Uma reversão clara da tendência"],
  confidence: { level: "low", justification: "Poucos fatos disponíveis." },
  inputsCited: ["ticker"],
  outlook: null,
  verdict: null,
};

function fakeClient(reply: AnalysisModelReply): AnalysisModelClient {
  return { analyze: vi.fn().mockResolvedValue(reply) };
}

function baseDeps(overrides: Partial<RequestAnalysisDeps> = {}): RequestAnalysisDeps {
  return {
    db: {} as RequestAnalysisDeps["db"],
    user: { id: "user-1" },
    client: fakeClient({
      kind: "refusal",
      model: "claude-sonnet-5-5",
      usage: { inputTokens: 10, outputTokens: 0 },
    }),
    assemble: vi.fn().mockResolvedValue({ ok: true, inputs }),
    repository: {
      reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
      complete: vi.fn(),
    },
    ...overrides,
  };
}

const requestInput = { subjectKind: "signal" as const, subjectId: "signal-1" };

describe("requestAnalysis", () => {
  it("answers unavailable before assembling or reserving anything when there is no client", async () => {
    const assemble = vi.fn();
    const reserve = vi.fn();
    const result = await requestAnalysis(
      baseDeps({ client: null, assemble, repository: { reserve, complete: vi.fn() } }),
      requestInput,
    );
    expect(result).toEqual({ status: "unavailable" });
    expect(assemble).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("answers not_found when assembly cannot find the subject", async () => {
    const result = await requestAnalysis(
      baseDeps({ assemble: vi.fn().mockResolvedValue({ ok: false, reason: "not_found" }) }),
      requestInput,
    );
    expect(result).toEqual({ status: "not_found" });
  });

  it("answers not_ready when assembly says the subject cannot be analyzed yet", async () => {
    const result = await requestAnalysis(
      baseDeps({ assemble: vi.fn().mockResolvedValue({ ok: false, reason: "not_ready" }) }),
      requestInput,
    );
    expect(result).toEqual({ status: "not_ready" });
  });

  it("answers cap_reached when reserve rejects over the monthly cap", async () => {
    const { AnalysisCapReachedError } = await import("./analyses-repository");
    const result = await requestAnalysis(
      baseDeps({
        repository: {
          reserve: vi.fn().mockRejectedValue(new AnalysisCapReachedError()),
          complete: vi.fn(),
        },
      }),
      requestInput,
    );
    expect(result).toEqual({ status: "cap_reached" });
  });

  it("rejects a refusal, counted because the call was paid", async () => {
    const complete = vi.fn();
    const result = await requestAnalysis(
      baseDeps({
        client: fakeClient({
          kind: "refusal",
          model: "claude-sonnet-5-5",
          usage: { inputTokens: 10, outputTokens: 0 },
        }),
        repository: {
          reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
          complete,
        },
      }),
      requestInput,
    );
    expect(result).toEqual({ status: "rejected" });
    expect(complete).toHaveBeenCalledWith(
      "req-1",
      expect.objectContaining({ outcome: "rejected", reason: { kind: "refusal" } }),
    );
  });

  it("rejects an incomplete reply (any stop reason other than end_turn or stop_sequence)", async () => {
    const complete = vi.fn();
    const result = await requestAnalysis(
      baseDeps({
        client: fakeClient({
          kind: "incomplete",
          stopReason: "model_context_window_exceeded",
          model: "claude-sonnet-5-5",
          usage: { inputTokens: 10, outputTokens: 20 },
        }),
        repository: {
          reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
          complete,
        },
      }),
      requestInput,
    );
    expect(result).toEqual({ status: "rejected" });
    expect(complete).toHaveBeenCalledWith(
      "req-1",
      expect.objectContaining({
        outcome: "rejected",
        reason: { kind: "incomplete", stopReason: "model_context_window_exceeded" },
      }),
    );
  });

  it("completes as failed on an API error, carrying its status", async () => {
    const complete = vi.fn();
    const result = await requestAnalysis(
      baseDeps({
        client: fakeClient({ kind: "api_error", status: 503 }),
        repository: {
          reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
          complete,
        },
      }),
      requestInput,
    );
    expect(result).toEqual({ status: "failed" });
    expect(complete).toHaveBeenCalledWith(
      "req-1",
      expect.objectContaining({ reason: { kind: "api_error", status: 503 } }),
    );
  });

  it("rejects a reply that fails the output schema", async () => {
    const complete = vi.fn();
    const result = await requestAnalysis(
      baseDeps({
        client: fakeClient({
          kind: "parsed",
          output: null,
          model: "claude-sonnet-5-5",
          usage: { inputTokens: 10, outputTokens: 20 },
        }),
        repository: {
          reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
          complete,
        },
      }),
      requestInput,
    );
    expect(result).toEqual({ status: "rejected" });
    expect(complete).toHaveBeenCalledWith(
      "req-1",
      expect.objectContaining({ outcome: "rejected", reason: { kind: "schema" } }),
    );
  });

  it("rejects a reply that cites a figure outside the facts", async () => {
    const complete = vi.fn();
    const output: AnalysisOutputV3 = {
      ...acceptedOutput,
      thesis: "O preço alvo é R$ 99,00.",
    };
    const result = await requestAnalysis(
      baseDeps({
        client: fakeClient({
          kind: "parsed",
          output,
          model: "claude-sonnet-5-5",
          usage: { inputTokens: 10, outputTokens: 20 },
        }),
        repository: {
          reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
          complete,
        },
      }),
      requestInput,
    );
    expect(result).toEqual({ status: "rejected" });
    const [, call] = complete.mock.calls[0] as [
      string,
      { outcome: string; reason: { kind: string } },
    ];
    expect(call.outcome).toBe("rejected");
    expect(call.reason.kind).toBe("citation");
  });

  it("accepts a reply that meets the contract and cites only its facts", async () => {
    const complete = vi.fn();
    const result = await requestAnalysis(
      baseDeps({
        client: fakeClient({
          kind: "parsed",
          output: acceptedOutput,
          model: "claude-sonnet-5-5",
          usage: { inputTokens: 10, outputTokens: 20 },
        }),
        repository: {
          reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
          complete,
        },
      }),
      requestInput,
    );
    expect(result).toEqual({
      status: "accepted",
      analysis: {
        id: "req-1",
        requestedAt: REQUESTED_AT,
        promptVersion: "analysis@3",
        model: "claude-sonnet-5-5",
        output: acceptedOutput,
        inputs,
      },
    });
    expect(complete).toHaveBeenCalledWith(
      "req-1",
      expect.objectContaining({ outcome: "accepted", output: acceptedOutput }),
    );
  });

  it("rejects an analysis@1-shaped reply, which lacks the outlook field", async () => {
    const complete = vi.fn();
    const v1Output: Record<string, unknown> = { ...acceptedOutput };
    delete v1Output.outlook;
    const result = await requestAnalysis(
      baseDeps({
        client: fakeClient({
          kind: "parsed",
          output: v1Output,
          model: "claude-sonnet-5-5",
          usage: { inputTokens: 10, outputTokens: 20 },
        }),
        repository: {
          reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
          complete,
        },
      }),
      requestInput,
    );
    expect(result).toEqual({ status: "rejected" });
    expect(complete).toHaveBeenCalledWith(
      "req-1",
      expect.objectContaining({ reason: { kind: "schema" } }),
    );
  });

  it("stores the outlook as an engine claim with its resolved horizon", async () => {
    const complete = vi.fn();
    const resolveHorizon = vi.fn().mockResolvedValue("2026-11-09");
    const output: AnalysisOutputV3 = {
      ...acceptedOutput,
      outlook: {
        instrumentFact: "ticker",
        direction: "above",
        levelFact: "proposal.pricing.breakEvens.0",
        horizon: "one_month",
        likelihood: "very_likely",
      },
    };
    const result = await requestAnalysis(
      baseDeps({
        client: fakeClient({
          kind: "parsed",
          output,
          model: "claude-sonnet-5-5",
          usage: { inputTokens: 10, outputTokens: 20 },
        }),
        repository: {
          reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
          complete,
        },
        resolveHorizon,
      }),
      requestInput,
    );
    expect(result).toMatchObject({ status: "accepted" });
    expect(resolveHorizon).toHaveBeenCalledWith({ kind: "sessions", count: 21 }, REQUESTED_AT);
    expect(complete).toHaveBeenCalledWith(
      "req-1",
      expect.objectContaining({
        outcome: "accepted",
        claim: {
          claim: { kind: "close_above", instrument: "VALE3", level: "59.1" },
          confidence: "0.9",
          horizon: "2026-11-09",
        },
      }),
    );
  });

  it.each([
    ["the calendar cannot place its horizon", () => Promise.resolve(null)],
    ["the calendar lookup fails", () => Promise.reject(new Error("connection reset"))],
  ])("accepts the analysis without a claim when %s", async (_, horizonLookup) => {
    const complete = vi.fn();
    const output: AnalysisOutputV3 = {
      ...acceptedOutput,
      outlook: {
        instrumentFact: "ticker",
        direction: "below",
        levelFact: "proposal.pricing.spot",
        horizon: "three_months",
        likelihood: "likely",
      },
    };
    const result = await requestAnalysis(
      baseDeps({
        client: fakeClient({
          kind: "parsed",
          output,
          model: "claude-sonnet-5-5",
          usage: { inputTokens: 10, outputTokens: 20 },
        }),
        repository: {
          reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
          complete,
        },
        resolveHorizon: vi.fn(horizonLookup),
      }),
      requestInput,
    );
    expect(result).toMatchObject({ status: "accepted" });
    expect(complete).toHaveBeenCalledWith(
      "req-1",
      expect.objectContaining({ outcome: "accepted", output, claim: null }),
    );
  });

  it("rejects, counted, an outlook whose level names no price fact", async () => {
    const complete = vi.fn();
    const resolveHorizon = vi.fn();
    const output: AnalysisOutputV3 = {
      ...acceptedOutput,
      outlook: {
        instrumentFact: "ticker",
        direction: "above",
        levelFact: "session",
        horizon: "one_week",
        likelihood: "likely",
      },
    };
    const result = await requestAnalysis(
      baseDeps({
        client: fakeClient({
          kind: "parsed",
          output,
          model: "claude-sonnet-5-5",
          usage: { inputTokens: 10, outputTokens: 20 },
        }),
        repository: {
          reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
          complete,
        },
        resolveHorizon,
      }),
      requestInput,
    );
    expect(result).toEqual({ status: "rejected" });
    expect(resolveHorizon).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith(
      "req-1",
      expect.objectContaining({
        outcome: "rejected",
        output: null,
        reason: { kind: "outlook", problem: "level_fact" },
      }),
    );
  });

  describe("verdict (docs/adr/0067)", () => {
    const verdict = {
      decision: "wait",
      justification: "A tendência ainda não confirmou.",
    } as const;

    async function reasonFor(subjectKind: "signal" | "suggestion", output: AnalysisOutputV3) {
      const complete = vi.fn();
      const result = await requestAnalysis(
        baseDeps({
          client: fakeClient({
            kind: "parsed",
            output,
            model: "claude-opus-5-5",
            usage: { inputTokens: 10, outputTokens: 20 },
          }),
          assemble: vi
            .fn()
            .mockResolvedValue({ ok: true, inputs: { ...inputs, subject: subjectKind } }),
          repository: {
            reserve: vi.fn().mockResolvedValue({ id: "req-1", requestedAt: REQUESTED_AT }),
            complete,
          },
        }),
        { subjectKind, subjectId: "subject-1" },
      );
      const [, call] = complete.mock.calls[0] as [string, { reason?: unknown }];
      return { status: result.status, reason: call.reason };
    }

    it("accepts a suggestion's analysis that ends with a verdict", async () => {
      expect(await reasonFor("suggestion", { ...acceptedOutput, verdict })).toEqual({
        status: "accepted",
        reason: null,
      });
    });

    it("rejects, counted, a suggestion's analysis without a verdict", async () => {
      expect(await reasonFor("suggestion", acceptedOutput)).toEqual({
        status: "rejected",
        reason: { kind: "verdict", problem: "missing" },
      });
    });

    it("rejects, counted, a verdict on anything but a suggestion", async () => {
      expect(await reasonFor("signal", { ...acceptedOutput, verdict })).toEqual({
        status: "rejected",
        reason: { kind: "verdict", problem: "unexpected" },
      });
    });
  });
});
