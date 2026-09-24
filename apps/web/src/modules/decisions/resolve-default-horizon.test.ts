import { describe, expect, it, vi } from "vitest";
import { centavosSchema, quantitySchema, tickerSchema } from "@fetha/contracts";
import { expiryByTicker } from "@/modules/market-data";
import type { ContemplatedOperation } from "@/modules/portfolio";

vi.mock("@/modules/market-data", () => ({ expiryByTicker: vi.fn() }));

const mockedExpiryByTicker = vi.mocked(expiryByTicker);

const { defaultHorizonsForOperations } = await import("./resolve-default-horizon");

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
