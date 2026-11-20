import type { ExitRule, ResolvedExitRule, RollRule, SessionDate } from "@fetha/contracts";

// Rolling (ticket #379; executing a roll is #382/#383) applies to a covered call and a credit
// spread, the structures whose short leg a user usually manages before expiry rather than lets
// expire or closes outright.
export const ROLLABLE_STRUCTURE_IDS: ReadonlySet<string> = new Set([
  "covered-call",
  "bull-put-spread",
  "bear-call-spread",
]);

const DEFAULT_ROLL_SESSIONS_BEFORE_EXPIRY = 5;

// Every exit rule the recipe carries, with the one date it can resolve to: a
// `days_before_expiry` rule becomes a concrete session via `sessionsBeforeExpiry`; a profit
// target or a stop carries no date, since it fires against price, not the calendar.
export function resolveExitRules(
  rules: readonly ExitRule[],
  sessionsBeforeExpiry: (businessDays: number) => SessionDate | null,
): ResolvedExitRule[] {
  return rules.map((rule) => ({
    rule,
    session: rule.kind === "days_before_expiry" ? sessionsBeforeExpiry(rule.businessDays) : null,
  }));
}

// The structure's roll rule: it applies only to a rollable structure, at the date its own
// `days_before_expiry` exit rule names, or a default of five sessions before expiry when it
// states none.
export function resolveRollRule(
  structureId: string,
  rules: readonly ExitRule[],
  sessionsBeforeExpiry: (businessDays: number) => SessionDate | null,
): RollRule {
  if (!ROLLABLE_STRUCTURE_IDS.has(structureId)) {
    return { applies: false, session: null };
  }
  const daysBeforeRule = rules.find((rule) => rule.kind === "days_before_expiry");
  const businessDays =
    daysBeforeRule?.kind === "days_before_expiry"
      ? daysBeforeRule.businessDays
      : DEFAULT_ROLL_SESSIONS_BEFORE_EXPIRY;
  return { applies: true, session: sessionsBeforeExpiry(businessDays) };
}
