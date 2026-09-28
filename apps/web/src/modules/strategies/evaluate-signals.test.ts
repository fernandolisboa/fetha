import { beforeEach, describe, expect, it, vi } from "vitest";

import { drizzleQueryError, postgresError } from "@/db/test/pg-error";

const tradingSessionForDate = vi.fn();
const previousTradingSession = vi.fn();
const calendarUpTo = vi.fn();
const loadMarketView = vi.fn();

vi.mock("@/modules/market-data", () => ({
  tradingSessionForDate,
  previousTradingSession,
  calendarUpTo,
  loadMarketView,
}));

const listAll = vi.fn();
vi.mock("./structures-repository", () => ({
  StructuresRepository: vi.fn().mockImplementation(function () {
    return { listAll };
  }),
}));

const activeStrategyUserIds = vi.fn();
vi.mock("./active-strategy-users", () => ({ activeStrategyUserIds }));

const listActiveDaily = vi.fn();
vi.mock("./strategies-repository", () => ({
  StrategiesRepository: vi.fn().mockImplementation(function () {
    return { listActiveDaily };
  }),
}));

const lastEvaluatedSession = vi.fn();
vi.mock("./signals-repository", () => ({
  SignalsRepository: vi.fn().mockImplementation(function () {
    return { lastEvaluatedSession };
  }),
}));

const watchlistList = vi.fn();
vi.mock("@/modules/watchlist", () => ({
  WatchlistRepository: vi.fn().mockImplementation(function () {
    return { list: watchlistList };
  }),
}));

const riskProfileCurrent = vi.fn();
vi.mock("@/modules/portfolio", () => ({
  RiskProfileRepository: vi.fn().mockImplementation(function () {
    return { current: riskProfileCurrent };
  }),
}));

const { evaluateSignalsForSession } = await import("./evaluate-signals");

const db = {} as never;

beforeEach(() => {
  tradingSessionForDate.mockReset().mockResolvedValue({
    date: "2026-09-09",
    open: "2026-09-09T13:00:00.000Z",
    close: "2026-09-09T21:00:00.000Z",
  });
  previousTradingSession.mockReset().mockResolvedValue(undefined);
  calendarUpTo.mockReset().mockResolvedValue([]);
  loadMarketView.mockReset();
  listAll.mockReset().mockResolvedValue([]);
  activeStrategyUserIds.mockReset().mockResolvedValue([]);
  listActiveDaily.mockReset().mockResolvedValue([]);
  watchlistList.mockReset().mockResolvedValue([]);
  riskProfileCurrent.mockReset().mockResolvedValue(null);
  lastEvaluatedSession.mockReset().mockResolvedValue(null);
});

describe("evaluateSignalsForSession", () => {
  it("reports setup failure as a stable code, never the raw driver message, in the response body", async () => {
    listAll.mockRejectedValueOnce(new Error("connection reset by peer at 10.0.0.1:5432"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const outcome = await evaluateSignalsForSession(db, ["2026-09-09"]);

    expect(outcome.errors).toEqual(["setup_failed"]);
    expect(outcome.errors.join()).not.toContain("connection reset");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("logs a failed setup query as its SQLSTATE, never the statement or its bound params", async () => {
    const failed = drizzleQueryError(postgresError("57014"));
    failed.message = "Failed query: select * from strategies where user_id = $1\nparams: user-a";
    listAll.mockRejectedValueOnce(failed);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await evaluateSignalsForSession(db, ["2026-09-09"]);

    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain("57014");
    expect(logged).not.toContain("Failed query");
    expect(logged).not.toContain("user-a");
    errorSpy.mockRestore();
  });

  it("reports a rejecting calendarUpTo as setup_failed, never a thrown error", async () => {
    calendarUpTo.mockReset().mockRejectedValueOnce(new Error("connection reset"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const outcome = await evaluateSignalsForSession(db, ["2026-09-09"]);

    expect(outcome.errors).toEqual(["setup_failed"]);
    errorSpy.mockRestore();
  });

  it("reports usersSkipped as a count, never the skipped users' own ids", async () => {
    activeStrategyUserIds.mockResolvedValueOnce(["user-a", "user-b"]);

    const outcome = await evaluateSignalsForSession(db, ["2026-09-09"], {
      deadlineAt: 0,
      now: () => 1,
    });

    expect(outcome.usersSkipped).toBe(2);
    expect(JSON.stringify(outcome)).not.toContain("user-a");
    expect(JSON.stringify(outcome)).not.toContain("user-b");
  });
});
