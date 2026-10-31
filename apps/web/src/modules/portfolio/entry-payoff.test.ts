import { describe, expect, it } from "vitest";
import {
  decimalStringSchema,
  instantSchema,
  sessionDateSchema,
  tickerSchema,
} from "@fetha/contracts";

import { adjustedSinceOpening } from "./entry-payoff";

const operation = {
  underlying: tickerSchema.parse("PETR4"),
  openedAt: sessionDateSchema.parse("2026-10-01"),
};
const today = sessionDateSchema.parse("2026-10-20");

function factor(ticker: string, exDate: string) {
  return {
    ticker: tickerSchema.parse(ticker),
    exDate: sessionDateSchema.parse(exDate),
    asOf: instantSchema.parse("2026-10-20T21:00:00.000Z"),
    factor: decimalStringSchema.parse("2"),
  };
}

describe("adjustedSinceOpening", () => {
  it("is false with no factor on the underlying after the opening", () => {
    expect(adjustedSinceOpening({ corporateActions: [] }, operation, today)).toBe(false);
    expect(
      adjustedSinceOpening(
        { corporateActions: [factor("PETR4", "2026-10-01"), factor("VALE3", "2026-10-10")] },
        operation,
        today,
      ),
    ).toBe(false);
  });

  it("is true for a factor on the underlying after the opening, up to today", () => {
    expect(
      adjustedSinceOpening({ corporateActions: [factor("PETR4", "2026-10-10")] }, operation, today),
    ).toBe(true);
  });

  it("ignores a factor announced for after today", () => {
    expect(
      adjustedSinceOpening({ corporateActions: [factor("PETR4", "2026-11-03")] }, operation, today),
    ).toBe(false);
  });
});
