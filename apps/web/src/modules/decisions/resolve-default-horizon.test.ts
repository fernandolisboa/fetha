import { describe, expect, it, vi } from "vitest";
import { centavosSchema, quantitySchema, tickerSchema } from "@fetha/contracts";
import { instantSchema } from "@fetha/contracts";
import { expiryByTicker, tradingSessionForDate } from "@/modules/market-data";
import { getMyOpenOperationExpiries, type ContemplatedOperation } from "@/modules/portfolio";
import type { SignalListItem } from "@/modules/strategies";

vi.mock("@/modules/market-data", () => ({
  expiryByTicker: vi.fn(),
  tradingSessionForDate: vi.fn(),
}));
vi.mock("@/modules/portfolio", () => ({ getMyOpenOperationExpiries: vi.fn() }));

const mockedExpiryByTicker = vi.mocked(expiryByTicker);
const mockedOpenOperationExpiries = vi.mocked(getMyOpenOperationExpiries);
const mockedTradingSessionForDate = vi.mocked(tradingSessionForDate);

const {
  defaultHorizonsForHeldOperations,
  defaultHorizonsForOperations,
  defaultHorizonsForSignals,
} = await import("./resolve-default-horizon");

const FIXED_NOW = new Date("2031-06-10T12:00:00.000Z");

function operation(id: string, ticker: string): ContemplatedOperation {
  return {
    id,
    structureId: "collar",
    underlying: tickerSchema.parse("PETR4"),
    legs: [
      {
        role: "call",
        side: "buy",
        ticker: tickerSchema.parse(ticker),
        quantity: quantitySchema.parse(100),
      },
    ],
    session: "2031-06-01",
    netPremiumCentavos: centavosSchema.parse(0),
    maxLossCentavos: null,
    maxGainCentavos: null,
    breachedLimits: [],
    createdAt: new Date("2031-06-01T00:00:00.000Z"),
  };
}

describe("defaultHorizonsForOperations", () => {
  it("defaults to the option leg's expiry when it is on or after today", async () => {
    mockedExpiryByTicker.mockResolvedValueOnce(new Map([["PETRA100", "2031-06-20"]]));

    const result = await defaultHorizonsForOperations(
      {} as never,
      [operation("op-live", "PETRA100")],
      FIXED_NOW,
    );

    expect(result.get("op-live")).toBe("2031-06-20");
  });

  it("defaults to null when the option leg's expiry has already passed", async () => {
    mockedExpiryByTicker.mockResolvedValueOnce(new Map([["PETRA090", "2031-06-01"]]));

    const result = await defaultHorizonsForOperations(
      {} as never,
      [operation("op-expired", "PETRA090")],
      FIXED_NOW,
    );

    expect(result.get("op-expired")).toBeNull();
  });
});

// FIXED_NOW is 09:00 in São Paulo on 2031-06-10: that session opens at
// 13:00Z and closes at 20:00Z.
function todaySession(close: string) {
  return {
    date: "2031-06-10",
    open: instantSchema.parse("2031-06-10T13:00:00.000Z"),
    close: instantSchema.parse(close),
  };
}

describe("defaultHorizonsForHeldOperations", () => {
  it("defaults to the operation's expiry", async () => {
    const result = await defaultHorizonsForHeldOperations(
      {} as never,
      [{ id: "op", expiry: "2031-06-20" }],
      FIXED_NOW,
    );

    expect(result.get("op")).toBe("2031-06-20");
  });

  it("has no default for a stock-only operation or an expiry already past", async () => {
    const result = await defaultHorizonsForHeldOperations(
      {} as never,
      [
        { id: "stock", expiry: null },
        { id: "past", expiry: "2031-06-09" },
      ],
      FIXED_NOW,
    );

    expect(result.get("stock")).toBeNull();
    expect(result.get("past")).toBeNull();
  });
});

describe("a default horizon of today (#259)", () => {
  it("keeps today while today's session is still open", async () => {
    mockedTradingSessionForDate.mockResolvedValueOnce(todaySession("2031-06-10T20:00:00.000Z"));

    const result = await defaultHorizonsForHeldOperations(
      {} as never,
      [{ id: "op", expiry: "2031-06-10" }],
      FIXED_NOW,
    );

    expect(mockedTradingSessionForDate).toHaveBeenLastCalledWith({}, "2031-06-10");
    expect(result.get("op")).toBe("2031-06-10");
  });

  it("has no default once today's session has closed, the way the action refuses it", async () => {
    mockedTradingSessionForDate.mockResolvedValue(todaySession("2031-06-10T20:00:00.000Z"));
    const afterClose = new Date("2031-06-10T21:00:00.000Z");
    mockedExpiryByTicker.mockResolvedValueOnce(new Map([["PETRA100", "2031-06-10"]]));
    mockedOpenOperationExpiries.mockResolvedValueOnce(new Map([["op-open", "2031-06-10"]]));

    const held = await defaultHorizonsForHeldOperations(
      {} as never,
      [{ id: "op", expiry: "2031-06-10" }],
      afterClose,
    );
    const signals = await defaultHorizonsForSignals(
      {} as never,
      [entrySignal("entry", "PETRA100"), exitSignal("exit", "op-open")],
      afterClose,
    );

    expect(held.get("op")).toBeNull();
    expect(signals.get("entry")).toBeNull();
    expect(signals.get("exit")).toBeNull();
  });

  it("has no default when today is not a trading session", async () => {
    mockedTradingSessionForDate.mockResolvedValueOnce(undefined);
    mockedExpiryByTicker.mockResolvedValueOnce(new Map([["PETRA100", "2031-06-10"]]));

    const result = await defaultHorizonsForOperations(
      {} as never,
      [operation("op", "PETRA100")],
      FIXED_NOW,
    );

    expect(result.get("op")).toBeNull();
  });

  it("reads today's session once for the whole page", async () => {
    mockedTradingSessionForDate.mockClear();
    mockedTradingSessionForDate.mockResolvedValue(todaySession("2031-06-10T20:00:00.000Z"));

    await defaultHorizonsForHeldOperations(
      {} as never,
      [
        { id: "a", expiry: "2031-06-10" },
        { id: "b", expiry: "2031-06-10" },
        { id: "c", expiry: "2031-06-20" },
      ],
      FIXED_NOW,
    );

    expect(mockedTradingSessionForDate).toHaveBeenCalledTimes(1);
  });
});

function exitSignal(id: string, operationId: string | null): SignalListItem {
  return {
    id,
    strategyId: "strategy",
    strategyName: "Travas",
    strategyVersionId: "version",
    ticker: tickerSchema.parse("PETR4"),
    timeframe: "D1",
    session: "2031-06-09",
    at: new Date("2031-06-09T20:00:00.000Z"),
    kind: "exit",
    indicators: [],
    proposal: null,
    operationId,
    rule: null,
    readAt: null,
  };
}

function entrySignal(id: string, optionTicker: string): SignalListItem {
  return {
    ...exitSignal(id, null),
    kind: "entry",
    proposal: {
      legs: [
        {
          role: "call",
          side: "buy",
          ticker: tickerSchema.parse(optionTicker),
          quantity: quantitySchema.parse(100),
        },
      ],
    } as unknown as SignalListItem["proposal"],
  };
}

describe("defaultHorizonsForSignals — exit signals (#257)", () => {
  it("defaults an exit signal to the expiry of the open operation it names", async () => {
    mockedExpiryByTicker.mockResolvedValueOnce(new Map());
    mockedOpenOperationExpiries.mockResolvedValueOnce(new Map([["op-open", "2031-06-20"]]));

    const result = await defaultHorizonsForSignals(
      {} as never,
      [exitSignal("exit-1", "op-open"), exitSignal("exit-2", "op-open")],
      FIXED_NOW,
    );

    expect(mockedOpenOperationExpiries).toHaveBeenLastCalledWith(["op-open"]);
    expect(result.get("exit-1")).toBe("2031-06-20");
    expect(result.get("exit-2")).toBe("2031-06-20");
  });

  it("has no default when the operation is stock-only, expired, or not one of the user's open operations", async () => {
    mockedExpiryByTicker.mockResolvedValueOnce(new Map());
    mockedOpenOperationExpiries.mockResolvedValueOnce(
      new Map([
        ["op-stock", null],
        ["op-past", "2031-06-09"],
      ]),
    );

    const result = await defaultHorizonsForSignals(
      {} as never,
      [
        exitSignal("stock", "op-stock"),
        exitSignal("past", "op-past"),
        exitSignal("unknown", "op-someone-else"),
        exitSignal("none", null),
      ],
      FIXED_NOW,
    );

    expect(result.get("stock")).toBeNull();
    expect(result.get("past")).toBeNull();
    expect(result.get("unknown")).toBeNull();
    expect(result.get("none")).toBeNull();
  });

  it("does not read the portfolio when no exit signal names an operation", async () => {
    mockedOpenOperationExpiries.mockClear();
    mockedExpiryByTicker.mockResolvedValue(new Map());

    await defaultHorizonsForSignals({} as never, [exitSignal("none", null)], FIXED_NOW);
    await defaultHorizonsForSignals({} as never, [entrySignal("entry", "PETRA100")], FIXED_NOW);

    expect(mockedOpenOperationExpiries).not.toHaveBeenCalled();
  });

  it("keeps an entry signal's leg-derived default beside an exit signal's", async () => {
    mockedExpiryByTicker.mockResolvedValueOnce(new Map([["PETRA100", "2031-07-18"]]));
    mockedOpenOperationExpiries.mockResolvedValueOnce(new Map([["op-open", "2031-06-20"]]));

    const result = await defaultHorizonsForSignals(
      {} as never,
      [entrySignal("entry", "PETRA100"), exitSignal("exit", "op-open")],
      FIXED_NOW,
    );

    expect(result.get("entry")).toBe("2031-07-18");
    expect(result.get("exit")).toBe("2031-06-20");
  });
});
