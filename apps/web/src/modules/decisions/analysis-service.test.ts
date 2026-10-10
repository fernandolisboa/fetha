import { describe, expect, it, vi } from "vitest";
import type { AnalysisInputs, AnalysisOutput } from "@fetha/contracts";

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
    proposal: null,
  },
};

const REQUESTED_AT = new Date("2026-10-10T15:00:00Z");

const acceptedOutput: AnalysisOutput = {
  thesis: "O sinal aponta para VALE3 na sessão de 09/10/2026.",
  counterThesis: "Sem indicadores, a leitura é frágil.",
  keyRisks: ["Risco de mercado"],
  maxLoss: "Os fatos não trazem um valor de perda máxima.",
  breakEvens: "Os fatos não trazem break-evens.",
  invalidation: ["Uma reversão clara da tendência"],
  confidence: { level: "low", justification: "Poucos fatos disponíveis." },
  inputsCited: ["ticker"],
};

function fakeClient(reply: AnalysisModelReply): AnalysisModelClient {
  return { analyze: vi.fn().mockResolvedValue(reply) };
}

function baseDeps(overrides: Partial<RequestAnalysisDeps> = {}): RequestAnalysisDeps {
  return {
    db: {} as RequestAnalysisDeps["db"],
    user: { id: "user-1" },
    client: fakeClient({ kind: "refusal" }),
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

  it("completes as failed on a refusal and never stores an output", async () => {
    const complete = vi.fn();
    const result = await requestAnalysis(
      baseDeps({
        client: fakeClient({ kind: "refusal" }),
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
      expect.objectContaining({ outcome: "failed", reason: { kind: "refusal" } }),
    );
  });

  it("completes as failed on a truncated reply", async () => {
    const complete = vi.fn();
    const result = await requestAnalysis(
      baseDeps({
        client: fakeClient({ kind: "max_tokens" }),
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
      expect.objectContaining({ reason: { kind: "max_tokens" } }),
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
    const output: AnalysisOutput = {
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
        promptVersion: "analysis@1",
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
});
