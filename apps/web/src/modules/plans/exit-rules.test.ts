import { describe, expect, it } from "vitest";
import { decimalStringSchema, type ExitRule, type SessionDate } from "@fetha/contracts";

import { resolveExitRules, resolveRollRule, rollTriggerSessionsBeforeExpiry } from "./exit-rules";

function session(value: string): SessionDate {
  return value;
}

function sessionsBeforeExpiry(businessDays: number): SessionDate | null {
  return businessDays === 5
    ? session("2027-01-09")
    : businessDays === 10
      ? session("2027-01-02")
      : null;
}

describe("resolveExitRules", () => {
  it("resolves a days_before_expiry rule to the session it names", () => {
    const rules: ExitRule[] = [{ kind: "days_before_expiry", businessDays: 5 }];
    expect(resolveExitRules(rules, sessionsBeforeExpiry)).toEqual([
      { rule: rules[0], session: "2027-01-09" },
    ]);
  });

  it("carries no date for a profit target or a stop loss", () => {
    const rules: ExitRule[] = [
      { kind: "profit_target", fractionOfPremium: decimalStringSchema.parse("0.5") },
      { kind: "stop_loss", multipleOfMaxLoss: decimalStringSchema.parse("1") },
    ];
    expect(resolveExitRules(rules, sessionsBeforeExpiry)).toEqual([
      { rule: rules[0], session: null },
      { rule: rules[1], session: null },
    ]);
  });
});

describe("resolveRollRule", () => {
  it("does not apply to a structure that is not rolled", () => {
    expect(resolveRollRule("bull-call-spread", [], sessionsBeforeExpiry)).toEqual({
      applies: false,
      session: null,
    });
  });

  it("applies to a covered call at its own days_before_expiry date", () => {
    const rules: ExitRule[] = [{ kind: "days_before_expiry", businessDays: 10 }];
    expect(resolveRollRule("covered-call", rules, sessionsBeforeExpiry)).toEqual({
      applies: true,
      session: "2027-01-02",
    });
  });

  it("applies to a credit spread at the default date when it names no days_before_expiry rule", () => {
    expect(resolveRollRule("bull-put-spread", [], sessionsBeforeExpiry)).toEqual({
      applies: true,
      session: "2027-01-09",
    });
  });
});

describe("rollTriggerSessionsBeforeExpiry", () => {
  it("is null for a structure that is not rolled", () => {
    expect(rollTriggerSessionsBeforeExpiry("bull-call-spread", [])).toBeNull();
  });

  it("is the structure's own days_before_expiry count", () => {
    const rules: ExitRule[] = [{ kind: "days_before_expiry", businessDays: 10 }];
    expect(rollTriggerSessionsBeforeExpiry("covered-call", rules)).toBe(10);
  });

  it("defaults to five sessions when the structure names no days_before_expiry rule", () => {
    expect(rollTriggerSessionsBeforeExpiry("bull-put-spread", [])).toBe(5);
  });
});
