import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Result, Score, ScoreInput } from "@fetha/engine";

const dueDecisionUserIds = vi.fn();
vi.mock("./due-decision-users", () => ({ dueDecisionUserIds }));

const buildScoreInput = vi.fn();
vi.mock("./score-input", () => ({ buildScoreInput }));

const dueForUser = vi.fn();
const insertIfAbsent = vi.fn();
vi.mock("./decision-scores-repository", () => ({
  DecisionScoresRepository: vi.fn().mockImplementation(function () {
    return { dueForUser, insertIfAbsent };
  }),
}));

const { scoreDueDecisions } = await import("./scoring-service");

const db = {} as never;

function scoreFixture(overrides: Partial<Score> = {}): Score {
  return {
    pnl: null,
    maxLoss: null,
    normalizedPnl: null,
    thesis: { claim: null },
    counterfactualPnl: null,
    notes: [],
    provenance: { engineVersion: "test-1", computedAt: "2026-09-09T21:00:00.000Z" },
    ...overrides,
  } as Score;
}

function okResult(score: Score): Result<Score> {
  return { ok: true, value: score };
}

function errResult(code: string): Result<Score> {
  return { ok: false, error: { code } } as Result<Score>;
}

const dueRow = { id: "decision-1" } as never;

beforeEach(() => {
  dueDecisionUserIds.mockReset();
  buildScoreInput.mockReset();
  dueForUser.mockReset().mockResolvedValue([]);
  insertIfAbsent.mockReset().mockResolvedValue({ inserted: true });
});

describe("scoreDueDecisions", () => {
  it("scores every due decision for every due user with the injected engine", async () => {
    dueDecisionUserIds.mockResolvedValue(["user-a"]);
    dueForUser.mockResolvedValueOnce([dueRow]);
    buildScoreInput.mockResolvedValueOnce({ ok: true, input: {} as ScoreInput });
    const score = vi.fn().mockResolvedValueOnce(okResult(scoreFixture()));

    const outcome = await scoreDueDecisions(db, "2026-09-09", { engine: { score } });

    expect(score).toHaveBeenCalledTimes(1);
    expect(insertIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ decisionId: "decision-1", engineVersion: "test-1" }),
    );
    expect(outcome).toMatchObject({
      usersScored: 1,
      usersSkipped: 0,
      decisionsScored: 1,
      decisionsSkipped: 0,
      errors: [],
    });
  });

  it("is idempotent: a decision the repository reports as already inserted is not double-counted as newly scored", async () => {
    dueDecisionUserIds.mockResolvedValue(["user-a"]);
    dueForUser.mockResolvedValueOnce([dueRow]);
    buildScoreInput.mockResolvedValueOnce({ ok: true, input: {} as ScoreInput });
    insertIfAbsent.mockResolvedValueOnce({ inserted: false });
    const score = vi.fn().mockResolvedValueOnce(okResult(scoreFixture()));

    const outcome = await scoreDueDecisions(db, "2026-09-09", { engine: { score } });

    expect(outcome.decisionsScored).toBe(0);
    expect(outcome.usersScored).toBe(0);
  });

  it("skips a decision the score input cannot be built for, without calling the engine", async () => {
    dueDecisionUserIds.mockResolvedValue(["user-a"]);
    dueForUser.mockResolvedValueOnce([dueRow]);
    buildScoreInput.mockResolvedValueOnce({ ok: false, reason: "missing_entry_price" });
    const score = vi.fn();

    const outcome = await scoreDueDecisions(db, "2026-09-09", { engine: { score } });

    expect(score).not.toHaveBeenCalled();
    expect(outcome.decisionsSkipped).toBe(1);
    expect(outcome.errors).toEqual(["build_failed:missing_entry_price"]);
  });

  it("retries insufficient_data next run without reporting it as an error", async () => {
    dueDecisionUserIds.mockResolvedValue(["user-a"]);
    dueForUser.mockResolvedValueOnce([dueRow]);
    buildScoreInput.mockResolvedValueOnce({ ok: true, input: {} as ScoreInput });
    const score = vi.fn().mockResolvedValueOnce(errResult("insufficient_data"));

    const outcome = await scoreDueDecisions(db, "2026-09-09", { engine: { score } });

    expect(outcome.decisionsSkipped).toBe(1);
    expect(outcome.errors).toEqual([]);
    expect(insertIfAbsent).not.toHaveBeenCalled();
  });

  it("reports a non-retriable engine error without throwing", async () => {
    dueDecisionUserIds.mockResolvedValue(["user-a"]);
    dueForUser.mockResolvedValueOnce([dueRow]);
    buildScoreInput.mockResolvedValueOnce({ ok: true, input: {} as ScoreInput });
    const score = vi.fn().mockResolvedValueOnce(errResult("unresolvable_view"));

    const outcome = await scoreDueDecisions(db, "2026-09-09", { engine: { score } });

    expect(outcome.decisionsSkipped).toBe(1);
    expect(outcome.errors).toEqual(["engine_error:unresolvable_view"]);
  });

  it("stops starting new users once the deadline has passed, reporting them as skipped", async () => {
    dueDecisionUserIds.mockResolvedValue(["user-a", "user-b"]);

    const outcome = await scoreDueDecisions(db, "2026-09-09", {
      deadlineAt: 0,
      now: () => 1,
      engine: { score: vi.fn() },
    });

    expect(outcome.usersSkipped).toBe(2);
    expect(dueForUser).not.toHaveBeenCalled();
  });

  it("never lets one user's failure abort the run for the next user (isolation of failure)", async () => {
    dueDecisionUserIds.mockResolvedValue(["user-a", "user-b"]);
    dueForUser.mockRejectedValueOnce(new Error("connection reset")).mockResolvedValueOnce([dueRow]);
    buildScoreInput.mockResolvedValueOnce({ ok: true, input: {} as ScoreInput });
    const score = vi.fn().mockResolvedValueOnce(okResult(scoreFixture()));

    const outcome = await scoreDueDecisions(db, "2026-09-09", { engine: { score } });

    expect(outcome.errors).toEqual(["scoring_failed"]);
    expect(outcome.decisionsScored).toBe(1);
  });
});
