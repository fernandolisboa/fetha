import { describe, expect, it, vi } from "vitest";
import { sessionDateSchema } from "@fetha/contracts";

import type { Idea, IdeaCard, ResearchResult } from "@/modules/radar";

import { MONTHLY_ANALYSIS_CAP } from "./analyses-repository";
import { LATEST_MODEL_START_MS, opinionOn, type OpinionPorts } from "./research-opinion";
import type { StoredResearch } from "./research-repository";

const CLOSE = sessionDateSchema.parse("2026-10-23");
const STARTED_AT = 1_000_000;

const idea = { underlying: "PETR4", recipeId: "x" } as unknown as Idea;
const result = {
  newestClose: CLOSE,
  sessionsLooked: 3,
  candidates: 4,
  dropped: { unpriced: 0, expires_too_soon: 0, exceeds_capital: 0, not_evaluable: 0 },
  usingDefaultProfile: true,
  timedOut: false,
  holding: [idea],
  noLongerHolding: [],
} as unknown as ResearchResult;

const stored = {
  id: "research-1",
  createdAt: new Date("2026-10-24T17:32:00Z"),
  newestClose: CLOSE,
  sessionsLooked: 3,
  candidates: 4,
  dropped: result.dropped,
  usingDefaultProfile: true,
  model: "claude-opus-5-5",
  overview: "Visão geral",
  inputs: { subject: "research", facts: {} },
  ideas: [],
} as unknown as StoredResearch;

function ports(overrides: Partial<OpinionPorts> = {}): OpinionPorts {
  return {
    resolveModel: vi.fn().mockResolvedValue({
      status: "ok",
      apiKey: "k",
      model: "m",
      family: "opus",
      markRejected: vi.fn(),
    }),
    takeRequestToken: vi.fn().mockResolvedValue(true),
    request: vi.fn().mockResolvedValue({ status: "accepted", researchId: "research-1" }),
    readStored: vi.fn().mockResolvedValue(stored),
    newestReadSession: vi.fn().mockResolvedValue(CLOSE),
    toCard: (value) => ({ underlying: value.underlying }) as unknown as IdeaCard,
    clock: () => STARTED_AT + 1_000,
    onError: vi.fn(),
    ...overrides,
  };
}

describe("opinionOn", () => {
  it("returns the stored research when Fetha answered", async () => {
    const outcome = await opinionOn(result, STARTED_AT, ports());
    expect(outcome.research?.id).toBe("research-1");
    expect(outcome).toMatchObject({ notice: null, stored: true });
  });

  it("asks for nothing when the engine found no idea", async () => {
    const p = ports();
    const empty = { ...result, holding: [] } as unknown as ResearchResult;
    expect(await opinionOn(empty, STARTED_AT, p)).toEqual({
      research: null,
      notice: null,
      stored: false,
    });
    expect(p.resolveModel).not.toHaveBeenCalled();
  });

  it("checks the key before it spends the per-minute token", async () => {
    const p = ports({ resolveModel: vi.fn().mockResolvedValue({ status: "own_key_missing" }) });
    expect(await opinionOn(result, STARTED_AT, p)).toMatchObject({ notice: { kind: "no_key" } });
    expect(p.takeRequestToken).not.toHaveBeenCalled();
    const unreadable = ports({
      resolveModel: vi.fn().mockResolvedValue({ status: "own_key_unreadable" }),
    });
    expect(await opinionOn(result, STARTED_AT, unreadable)).toMatchObject({
      notice: { kind: "key_unreadable" },
    });
    expect(unreadable.takeRequestToken).not.toHaveBeenCalled();
  });

  it("says so when the account is past its per-minute floor, without calling the model", async () => {
    const p = ports({ takeRequestToken: vi.fn().mockResolvedValue(false) });
    expect(await opinionOn(result, STARTED_AT, p)).toMatchObject({
      notice: { kind: "rate_limited" },
    });
    expect(p.request).not.toHaveBeenCalled();
  });

  it("names the cap when it is reached, and says failed for any other way the reply is lost", async () => {
    const capped = ports({ request: vi.fn().mockResolvedValue({ status: "cap_reached" }) });
    expect(await opinionOn(result, STARTED_AT, capped)).toMatchObject({
      notice: { kind: "cap_reached", cap: MONTHLY_ANALYSIS_CAP },
    });
    for (const status of ["rejected", "failed", "not_ready", "unavailable"] as const) {
      const p = ports({ request: vi.fn().mockResolvedValue({ status }) });
      expect(await opinionOn(result, STARTED_AT, p)).toMatchObject({ notice: { kind: "failed" } });
    }
  });

  it("does not start the model call once the engine has used the time it needs", async () => {
    const p = ports({ clock: () => STARTED_AT + LATEST_MODEL_START_MS + 1 });
    expect(await opinionOn(result, STARTED_AT, p)).toMatchObject({ notice: { kind: "failed" } });
    expect(p.request).not.toHaveBeenCalled();
    const onTime = ports({ clock: () => STARTED_AT + LATEST_MODEL_START_MS });
    await opinionOn(result, STARTED_AT, onTime);
    expect(onTime.request).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      STARTED_AT + LATEST_MODEL_START_MS,
    );
  });

  it("keeps the engine's view when assembling or calling throws, and logs the error", async () => {
    const error = new Error("neon unreachable");
    const p = ports({ request: vi.fn().mockRejectedValue(error) });
    expect(await opinionOn(result, STARTED_AT, p)).toEqual({
      research: null,
      notice: { kind: "failed" },
      stored: false,
    });
    expect(p.onError).toHaveBeenCalledWith(error);
  });

  it("keeps the engine's view when the key lookup or the rate limit throws", async () => {
    const lookup = ports({ resolveModel: vi.fn().mockRejectedValue(new Error("boom")) });
    expect(await opinionOn(result, STARTED_AT, lookup)).toMatchObject({
      notice: { kind: "failed" },
    });
    const limit = ports({ takeRequestToken: vi.fn().mockRejectedValue(new Error("boom")) });
    expect(await opinionOn(result, STARTED_AT, limit)).toMatchObject({
      notice: { kind: "failed" },
    });
  });

  it("reports the research as stored even when only the re-read fails", async () => {
    const reading = ports({ readStored: vi.fn().mockRejectedValue(new Error("boom")) });
    expect(await opinionOn(result, STARTED_AT, reading)).toEqual({
      research: null,
      notice: { kind: "failed" },
      stored: true,
    });
    const missing = ports({ readStored: vi.fn().mockResolvedValue(null) });
    expect(await opinionOn(result, STARTED_AT, missing)).toMatchObject({
      research: null,
      stored: true,
    });
  });
});
