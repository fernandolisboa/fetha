import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Capabilities, Engine, Result, Score, ScoreInput } from "@fetha/engine";

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

const listAll = vi.fn();
vi.mock("@/modules/strategies", () => ({
  StructuresRepository: vi.fn().mockImplementation(function () {
    return { listAll };
  }),
}));

const freshness = vi.fn();
const calendarUpTo = vi.fn();
vi.mock("@/modules/market-data", () => ({ freshness, calendarUpTo }));

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

const FAKE_ENGINE_VERSION = "fake-engine-1";

// Widened past `Pick<Engine, "score">` (round 3 item 9): an unscorable row
// must take its own `engineVersion` from whichever engine actually ran this
// scoring pass, so every fixture below carries its own `capabilities()` the
// same way the real engine does.
function fakeEngine(score: Engine["score"]): Pick<Engine, "score" | "capabilities"> {
  return {
    score,
    capabilities: () => ({ engineVersion: FAKE_ENGINE_VERSION }) as Capabilities,
  };
}

const dueRow = { id: "decision-1" } as never;
const builtInput = { horizon: "2026-09-09" } as unknown as ScoreInput;

beforeEach(() => {
  dueDecisionUserIds.mockReset();
  buildScoreInput.mockReset();
  dueForUser.mockReset().mockResolvedValue([]);
  insertIfAbsent.mockReset().mockResolvedValue({ inserted: true });
  listAll.mockReset().mockResolvedValue([]);
  freshness.mockReset().mockResolvedValue([]);
  calendarUpTo.mockReset().mockResolvedValue([]);
});

describe("scoreDueDecisions", () => {
  it("scores every due decision for every due user with the injected engine", async () => {
    dueDecisionUserIds.mockResolvedValue(["user-a"]);
    dueForUser.mockResolvedValueOnce([dueRow]);
    buildScoreInput.mockResolvedValueOnce({ ok: true, input: builtInput });
    const score = vi.fn().mockResolvedValueOnce(okResult(scoreFixture()));

    const outcome = await scoreDueDecisions(
      db,
      { okSessions: ["2026-09-09"] },
      { engine: fakeEngine(score) },
    );

    expect(score).toHaveBeenCalledTimes(1);
    expect(insertIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ decisionId: "decision-1", engineVersion: "test-1" }),
    );
    expect(outcome).toMatchObject({
      asOfSession: "2026-09-09",
      usersScored: 1,
      usersSkipped: 0,
      decisionsScored: 1,
      decisionsSkipped: 0,
      errors: [],
    });
  });

  it("resolves the as-of session as the newest succeeded cotahist run when this run drained nothing new", async () => {
    freshness.mockResolvedValue([
      { source: "cotahist", status: "succeeded", session: "2026-09-07" },
    ]);
    dueDecisionUserIds.mockResolvedValue([]);

    const outcome = await scoreDueDecisions(
      db,
      { okSessions: [] },
      { engine: fakeEngine(vi.fn()) },
    );

    expect(outcome.asOfSession).toBe("2026-09-07");
    expect(dueDecisionUserIds).toHaveBeenCalledWith(db, "2026-09-07");
  });

  it("does nothing when no as-of session can be resolved at all", async () => {
    freshness.mockResolvedValue([]);

    const outcome = await scoreDueDecisions(
      db,
      { okSessions: [] },
      { engine: fakeEngine(vi.fn()) },
    );

    expect(outcome).toMatchObject({ asOfSession: "", usersScored: 0, usersSkipped: 0 });
    expect(dueDecisionUserIds).not.toHaveBeenCalled();
  });

  it("returns an empty outcome with a setup_failed error, not a throw, when resolveAsOfSession's own read rejects (round 3 item 4)", async () => {
    freshness.mockRejectedValue(new Error("connection reset"));

    const outcome = await scoreDueDecisions(
      db,
      { okSessions: [] },
      { engine: fakeEngine(vi.fn()) },
    );

    expect(outcome).toEqual({
      asOfSession: "",
      usersScored: 0,
      usersSkipped: 0,
      decisionsScored: 0,
      decisionsSkipped: 0,
      errors: [{ decisionId: null, kind: "setup_failed" }],
    });
    expect(dueDecisionUserIds).not.toHaveBeenCalled();
  });

  it("returns an empty outcome with a setup_failed error, not a throw, when the structure catalog read rejects (round 3 item 4)", async () => {
    listAll.mockRejectedValue(new Error("connection reset"));

    const outcome = await scoreDueDecisions(
      db,
      { okSessions: ["2026-09-09"] },
      { engine: fakeEngine(vi.fn()) },
    );

    expect(outcome).toEqual({
      asOfSession: "",
      usersScored: 0,
      usersSkipped: 0,
      decisionsScored: 0,
      decisionsSkipped: 0,
      errors: [{ decisionId: null, kind: "setup_failed" }],
    });
    expect(dueDecisionUserIds).not.toHaveBeenCalled();
  });

  it("returns an empty outcome with a setup_failed error, not a throw, when the due-user list read rejects (round 3 item 4)", async () => {
    dueDecisionUserIds.mockRejectedValue(new Error("connection reset"));

    const outcome = await scoreDueDecisions(
      db,
      { okSessions: ["2026-09-09"] },
      { engine: fakeEngine(vi.fn()) },
    );

    expect(outcome).toEqual({
      asOfSession: "",
      usersScored: 0,
      usersSkipped: 0,
      decisionsScored: 0,
      decisionsSkipped: 0,
      errors: [{ decisionId: null, kind: "setup_failed" }],
    });
    expect(dueForUser).not.toHaveBeenCalled();
  });

  it("is idempotent: a decision the repository reports as already inserted is not double-counted as newly scored", async () => {
    dueDecisionUserIds.mockResolvedValue(["user-a"]);
    dueForUser.mockResolvedValueOnce([dueRow]);
    buildScoreInput.mockResolvedValueOnce({ ok: true, input: builtInput });
    insertIfAbsent.mockResolvedValueOnce({ inserted: false });
    const score = vi.fn().mockResolvedValueOnce(okResult(scoreFixture()));

    const outcome = await scoreDueDecisions(
      db,
      { okSessions: ["2026-09-09"] },
      { engine: fakeEngine(score) },
    );

    expect(outcome.decisionsScored).toBe(0);
    expect(outcome.usersScored).toBe(0);
  });

  it("skips a decision the score input cannot be built for, without calling the engine, and marks it unscorable", async () => {
    dueDecisionUserIds.mockResolvedValue(["user-a"]);
    dueForUser.mockResolvedValueOnce([dueRow]);
    buildScoreInput.mockResolvedValueOnce({ ok: false, reason: "missing_entry_price" });
    const score = vi.fn();

    const outcome = await scoreDueDecisions(
      db,
      { okSessions: ["2026-09-09"] },
      { engine: fakeEngine(score) },
    );

    expect(score).not.toHaveBeenCalled();
    expect(outcome.decisionsSkipped).toBe(1);
    expect(outcome.errors).toEqual([
      { decisionId: "decision-1", kind: "build_failed:missing_entry_price" },
    ]);
    expect(insertIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionId: "decision-1",
        unscorableReason: "build_failed:missing_entry_price",
        engineVersion: FAKE_ENGINE_VERSION,
      }),
    );
  });

  it("takes an unscorable row's engineVersion from the engine actually in use, not the real engine (round 3 item 9)", async () => {
    dueDecisionUserIds.mockResolvedValue(["user-a"]);
    dueForUser.mockResolvedValueOnce([dueRow]);
    buildScoreInput.mockResolvedValueOnce({ ok: true, input: builtInput });
    const score = vi.fn().mockResolvedValueOnce(errResult("unresolvable_view"));

    await scoreDueDecisions(db, { okSessions: ["2026-09-09"] }, { engine: fakeEngine(score) });

    expect(insertIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ decisionId: "decision-1", engineVersion: FAKE_ENGINE_VERSION }),
    );
  });

  it("memoizes the calendar lookup for insufficient_data exhaustion once per run, not once per decision (round 3 item 9)", async () => {
    dueDecisionUserIds.mockResolvedValue(["user-a"]);
    const otherRow = { id: "decision-2" } as never;
    dueForUser.mockResolvedValueOnce([dueRow, otherRow]);
    buildScoreInput.mockResolvedValue({ ok: true, input: builtInput });
    const score = vi.fn().mockResolvedValue(errResult("insufficient_data"));

    const outcome = await scoreDueDecisions(
      db,
      { okSessions: ["2026-09-09"] },
      { engine: fakeEngine(score) },
    );

    expect(outcome.decisionsSkipped).toBe(2);
    expect(calendarUpTo).toHaveBeenCalledTimes(1);
  });

  it("retries insufficient_data next run without reporting it as an error, while the retry window is open", async () => {
    dueDecisionUserIds.mockResolvedValue(["user-a"]);
    dueForUser.mockResolvedValueOnce([dueRow]);
    buildScoreInput.mockResolvedValueOnce({ ok: true, input: builtInput });
    calendarUpTo.mockResolvedValue([{ date: "2026-09-09" }]);
    const score = vi.fn().mockResolvedValueOnce(errResult("insufficient_data"));

    const outcome = await scoreDueDecisions(
      db,
      { okSessions: ["2026-09-09"] },
      { engine: fakeEngine(score) },
    );

    expect(outcome.decisionsSkipped).toBe(1);
    expect(outcome.errors).toEqual([]);
    expect(insertIfAbsent).not.toHaveBeenCalled();
  });

  it("marks insufficient_data unscorable once the as-of session is 5 trading sessions past the resolved horizon", async () => {
    dueDecisionUserIds.mockResolvedValue(["user-a"]);
    dueForUser.mockResolvedValueOnce([dueRow]);
    buildScoreInput.mockResolvedValueOnce({ ok: true, input: builtInput });
    calendarUpTo.mockResolvedValue([
      { date: "2026-09-10" },
      { date: "2026-09-11" },
      { date: "2026-09-14" },
      { date: "2026-09-15" },
      { date: "2026-09-16" },
    ]);
    const score = vi.fn().mockResolvedValueOnce(errResult("insufficient_data"));

    const outcome = await scoreDueDecisions(
      db,
      { okSessions: ["2026-09-16"] },
      { engine: fakeEngine(score) },
    );

    expect(outcome.decisionsSkipped).toBe(1);
    expect(outcome.errors).toEqual([
      { decisionId: "decision-1", kind: "unscorable:insufficient_data" },
    ]);
    expect(insertIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ decisionId: "decision-1", unscorableReason: "insufficient_data" }),
    );
  });

  it("reports a non-retriable engine error without throwing and marks it unscorable", async () => {
    dueDecisionUserIds.mockResolvedValue(["user-a"]);
    dueForUser.mockResolvedValueOnce([dueRow]);
    buildScoreInput.mockResolvedValueOnce({ ok: true, input: builtInput });
    const score = vi.fn().mockResolvedValueOnce(errResult("unresolvable_view"));

    const outcome = await scoreDueDecisions(
      db,
      { okSessions: ["2026-09-09"] },
      { engine: fakeEngine(score) },
    );

    expect(outcome.decisionsSkipped).toBe(1);
    expect(outcome.errors).toEqual([
      { decisionId: "decision-1", kind: "engine_error:unresolvable_view" },
    ]);
    expect(insertIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionId: "decision-1",
        unscorableReason: "engine_error:unresolvable_view",
      }),
    );
  });

  it("stops starting new users once the deadline has passed, reporting them as skipped", async () => {
    dueDecisionUserIds.mockResolvedValue(["user-a", "user-b"]);

    const outcome = await scoreDueDecisions(
      db,
      { okSessions: ["2026-09-09"] },
      { deadlineAt: 0, now: () => 1, engine: fakeEngine(vi.fn()) },
    );

    expect(outcome.usersSkipped).toBe(2);
    expect(dueForUser).not.toHaveBeenCalled();
  });

  it("never lets one user's failure abort the run for the next user (isolation of failure)", async () => {
    dueDecisionUserIds.mockResolvedValue(["user-a", "user-b"]);
    dueForUser.mockRejectedValueOnce(new Error("connection reset")).mockResolvedValueOnce([dueRow]);
    buildScoreInput.mockResolvedValueOnce({ ok: true, input: builtInput });
    const score = vi.fn().mockResolvedValueOnce(okResult(scoreFixture()));

    const outcome = await scoreDueDecisions(
      db,
      { okSessions: ["2026-09-09"] },
      { engine: fakeEngine(score) },
    );

    expect(outcome.errors).toEqual([{ decisionId: null, kind: "scoring_failed" }]);
    expect(outcome.decisionsScored).toBe(1);
  });

  it("never lets one decision's failure abort the rest of that user's own due list (isolation of failure)", async () => {
    dueDecisionUserIds.mockResolvedValue(["user-a"]);
    const otherRow = { id: "decision-2" } as never;
    dueForUser.mockResolvedValueOnce([dueRow, otherRow]);
    buildScoreInput
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce({ ok: true, input: builtInput });
    const score = vi.fn().mockResolvedValueOnce(okResult(scoreFixture()));

    const outcome = await scoreDueDecisions(
      db,
      { okSessions: ["2026-09-09"] },
      { engine: fakeEngine(score) },
    );

    expect(outcome.errors).toEqual([{ decisionId: "decision-1", kind: "scoring_failed" }]);
    expect(outcome.decisionsScored).toBe(1);
  });
});
