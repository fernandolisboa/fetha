import { describe, expect, it } from "vitest";
import type { Ticker } from "@fetha/contracts";

import { buildRollAgenda, suggestRollAction } from "./roll-agenda";

const base = {
  operationId: "op-1",
  underlying: "PETR4" as Ticker,
  expiry: "2027-01-15",
  hasShortLeg: true,
  anyShortLegInTheMoney: false,
  anyLongLegInTheMoney: false,
  moneynessKnown: true,
  rollTriggerSessions: 5,
};

describe("suggestRollAction", () => {
  it("is null outside the agenda window", () => {
    expect(suggestRollAction({ ...base, sessionsToExpiry: 11 })).toBeNull();
  });

  it("is null for a negative sessions-to-expiry (already past expiry)", () => {
    expect(suggestRollAction({ ...base, sessionsToExpiry: -1 })).toBeNull();
  });

  it("suggests rolling once the structure's own trigger is reached", () => {
    expect(suggestRollAction({ ...base, sessionsToExpiry: 5 })?.action).toBe("roll");
    expect(suggestRollAction({ ...base, sessionsToExpiry: 6 })?.action).toBe("let_expire");
  });

  it("suggests letting it expire for a structure that does not roll, far from assignment risk", () => {
    expect(
      suggestRollAction({ ...base, rollTriggerSessions: null, sessionsToExpiry: 3 })?.action,
    ).toBe("let_expire");
  });

  it("suggests closing early when a short leg is already in the money one session from expiry", () => {
    expect(
      suggestRollAction({
        ...base,
        sessionsToExpiry: 1,
        anyShortLegInTheMoney: true,
      })?.action,
    ).toBe("close_early_assignment_risk");
  });

  it("prefers the roll trigger over assignment risk when expiry is not yet imminent", () => {
    expect(
      suggestRollAction({
        ...base,
        sessionsToExpiry: 5,
        anyShortLegInTheMoney: true,
      })?.action,
    ).toBe("roll");
  });

  it("watches an in-the-money short before its own roll trigger or the assignment-risk window, rather than suggesting it expire", () => {
    expect(
      suggestRollAction({
        ...base,
        sessionsToExpiry: 8,
        anyShortLegInTheMoney: true,
      })?.action,
    ).toBe("watch");
  });

  it("still suggests letting it expire when every short leg is out of the money", () => {
    expect(
      suggestRollAction({
        ...base,
        sessionsToExpiry: 8,
        anyShortLegInTheMoney: false,
      })?.action,
    ).toBe("let_expire");
  });

  it("watches rather than lets expire when a long leg is in the money, even with every short leg out of the money", () => {
    expect(
      suggestRollAction({
        ...base,
        rollTriggerSessions: null,
        sessionsToExpiry: 8,
        anyLongLegInTheMoney: true,
      })?.action,
    ).toBe("watch");
  });

  it("watches rather than lets expire a long-only operation, since it has no short leg", () => {
    expect(
      suggestRollAction({
        ...base,
        hasShortLeg: false,
        rollTriggerSessions: null,
        sessionsToExpiry: 8,
      })?.action,
    ).toBe("watch");
  });

  it("watches rather than lets expire when moneyness could not be computed", () => {
    expect(
      suggestRollAction({
        ...base,
        rollTriggerSessions: null,
        sessionsToExpiry: 8,
        moneynessKnown: false,
      })?.action,
    ).toBe("watch");
  });

  it("never flags assignment risk when moneyness could not be computed, even with a tight window", () => {
    expect(
      suggestRollAction({
        ...base,
        rollTriggerSessions: null,
        anyShortLegInTheMoney: true,
        sessionsToExpiry: 1,
        moneynessKnown: false,
      })?.action,
    ).toBe("watch");
  });
});

describe("buildRollAgenda", () => {
  it("drops operations outside the window and sorts the rest by sessions to expiry", () => {
    const agenda = buildRollAgenda([
      { ...base, operationId: "far", sessionsToExpiry: 20 },
      { ...base, operationId: "near", sessionsToExpiry: 1, anyShortLegInTheMoney: true },
      { ...base, operationId: "mid", sessionsToExpiry: 5 },
    ]);

    expect(agenda.map((item) => item.operationId)).toEqual(["near", "mid"]);
  });
});
