import { describe, expect, it } from "vitest";
import { centavosSchema, decimalStringSchema, sessionDateSchema } from "@fetha/contracts";
import type { LimitBreach } from "@fetha/engine";

import {
  assessIdea,
  dedupeCandidates,
  MIN_SESSIONS_TO_EXPIRY,
  NEAR_EXPIRY_SESSIONS,
  sessionsAfter,
  sortIdeas,
  type AssessmentInput,
  type Candidate,
} from "./research-rules";

const session = (value: string) => sessionDateSchema.parse(value);
const centavos = (value: number) => centavosSchema.parse(value);

function candidate(
  underlying: string,
  recipeId: string,
  found: string,
  suggestionId: string | null = null,
): Candidate {
  return { underlying, recipeId, session: session(found), suggestionId };
}

describe("dedupeCandidates", () => {
  it("keeps the newest finding of each underlying and recipe, with its session and suggestion", () => {
    const result = dedupeCandidates([
      candidate("PETR4", "long-call-low-iv", "2026-10-20", "old"),
      candidate("PETR4", "long-call-low-iv", "2026-10-23", "new"),
      candidate("PETR4", "bull-call-spread-low-iv", "2026-10-21", null),
      candidate("VALE3", "long-call-low-iv", "2026-10-22", "vale"),
    ]);

    expect(result).toEqual([
      candidate("PETR4", "long-call-low-iv", "2026-10-23", "new"),
      candidate("VALE3", "long-call-low-iv", "2026-10-22", "vale"),
      candidate("PETR4", "bull-call-spread-low-iv", "2026-10-21", null),
    ]);
  });

  it("keeps the same recipe on two underlyings and two recipes on one underlying", () => {
    const result = dedupeCandidates([
      candidate("PETR4", "a", "2026-10-23"),
      candidate("VALE3", "a", "2026-10-23"),
      candidate("PETR4", "b", "2026-10-23"),
    ]);

    expect(result).toHaveLength(3);
  });

  it("returns nothing for no findings", () => {
    expect(dedupeCandidates([])).toEqual([]);
  });
});

describe("sessionsAfter", () => {
  const calendar = ["2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28"].map(session);

  it("counts the trading sessions after the close up to and including the expiry", () => {
    expect(sessionsAfter(calendar, session("2026-10-23"), session("2026-10-28"))).toBe(3);
    expect(sessionsAfter(calendar, session("2026-10-23"), session("2026-10-26"))).toBe(1);
  });

  it("is zero when the expiry is the close itself or earlier", () => {
    expect(sessionsAfter(calendar, session("2026-10-26"), session("2026-10-26"))).toBe(0);
    expect(sessionsAfter(calendar, session("2026-10-26"), session("2026-10-23"))).toBe(0);
  });
});

const decimal = (value: string) => decimalStringSchema.parse(value);
const BREACH: LimitBreach = {
  limit: "maxLossPerOperation",
  value: decimal("0.04"),
  allowed: decimal("0.02"),
};

function input(overrides: Partial<AssessmentInput> = {}): AssessmentInput {
  return {
    ruleHolds: true,
    foundOn: session("2026-10-21"),
    maxLoss: centavos(100_000),
    sessionsToExpiry: 20,
    declaredCapital: centavos(5_000_000),
    breaches: [],
    ...overrides,
  };
}

describe("assessIdea", () => {
  it("holds with no alert when the rule holds, the lot is priced and nothing is near", () => {
    expect(assessIdea(input())).toEqual({ kind: "idea", holding: true, alerts: [] });
  });

  it("drops an idea expiring in fewer than 5 sessions and keeps one expiring in exactly 5", () => {
    expect(MIN_SESSIONS_TO_EXPIRY).toBe(5);
    expect(assessIdea(input({ sessionsToExpiry: 4 }))).toEqual({
      kind: "drop",
      reason: "expires_too_soon",
    });
    expect(assessIdea(input({ sessionsToExpiry: 5 })).kind).toBe("idea");
  });

  it("drops a lot whose max loss is above the whole declared capital, not one equal to it", () => {
    const capital = centavos(5_000_000);
    expect(assessIdea(input({ declaredCapital: capital, maxLoss: centavos(5_000_001) }))).toEqual({
      kind: "drop",
      reason: "exceeds_capital",
    });
    expect(assessIdea(input({ declaredCapital: capital, maxLoss: capital })).kind).toBe("idea");
  });

  it("reports the first reason when several apply: too soon, then capital", () => {
    expect(assessIdea(input({ sessionsToExpiry: 2, maxLoss: centavos(9_000_000) }))).toEqual({
      kind: "drop",
      reason: "expires_too_soon",
    });
  });

  it("alerts near expiry within 10 sessions and not at 11", () => {
    expect(NEAR_EXPIRY_SESSIONS).toBe(10);
    expect(assessIdea(input({ sessionsToExpiry: 10 }))).toEqual({
      kind: "idea",
      holding: true,
      alerts: [{ kind: "near_expiry", sessionsLeft: 10 }],
    });
    expect(assessIdea(input({ sessionsToExpiry: 11 }))).toEqual({
      kind: "idea",
      holding: true,
      alerts: [],
    });
  });

  it("puts an idea whose rule stopped holding in the other group, with the session it was found on", () => {
    expect(assessIdea(input({ ruleHolds: false }))).toEqual({
      kind: "idea",
      holding: false,
      alerts: [{ kind: "rule_no_longer_holds", foundOn: session("2026-10-21") }],
    });
  });

  it("raises one alert for each breached limit, between the rule and the expiry alerts", () => {
    const other: LimitBreach = {
      limit: "maxPremiumBought",
      value: decimal("0.09"),
      allowed: decimal("0.05"),
    };
    expect(
      assessIdea(input({ ruleHolds: false, breaches: [BREACH, other], sessionsToExpiry: 7 })),
    ).toEqual({
      kind: "idea",
      holding: false,
      alerts: [
        { kind: "rule_no_longer_holds", foundOn: session("2026-10-21") },
        { kind: "limit_breach", breach: BREACH },
        { kind: "limit_breach", breach: other },
        { kind: "near_expiry", sessionsLeft: 7 },
      ],
    });
  });
});

describe("sortIdeas", () => {
  const idea = (underlying: string, recipeId: string, tradedSeries: number) => ({
    underlying,
    recipeId,
    reading: { options: { tradedSeries } },
  });

  it("orders by traded series desc, then ticker, then recipe id", () => {
    const sorted = sortIdeas([
      idea("VALE3", "b", 10),
      idea("PETR4", "b", 10),
      idea("PETR4", "a", 10),
      idea("ITUB4", "z", 30),
      idea("BBAS3", "a", 5),
    ]);

    expect(sorted.map((entry) => `${entry.underlying}/${entry.recipeId}`)).toEqual([
      "ITUB4/z",
      "PETR4/a",
      "PETR4/b",
      "VALE3/b",
      "BBAS3/a",
    ]);
  });
});
