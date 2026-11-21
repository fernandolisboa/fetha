import type { ExitRule, ResolvedExitRule, RollRule, SessionDate } from "@fetha/contracts";

// Rolling (ticket #379; executing a roll is #382/#383) applies to a covered call and a credit
// spread, the structures whose short leg a user usually manages before expiry rather than lets
// expire or closes outright.
export const ROLLABLE_STRUCTURE_IDS: ReadonlySet<string> = new Set([
  "covered-call",
  "bull-put-spread",
  "bear-call-spread",
]);

// The default a structure's own roll rule falls back to when its recipe names no
// `days_before_expiry` exit rule. Not reused by the portfolio roll agenda (#382,
// `roll/roll-agenda-queries.ts`): the agenda has no structure id to look up (a held operation's
// own `operations` row never stores one, ADR-0080), and importing this value there would couple
// `portfolio` to a `plans` default that is a coincidence of today's catalog, not a shared
// invariant, so the agenda duplicates the literal instead.
export const DEFAULT_ROLL_SESSIONS_BEFORE_EXPIRY = 5;

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

// The raw business-day count a structure's roll rule fires at, with no calendar involved. Null
// for a structure that does not roll. Not exported: `resolveRollRule` is the only caller, and
// `roll/roll-agenda.ts` has no structure id to resolve a rule from in the first place (a held
// operation's own `operations` row never stores one, ADR-0080) so it carries its own literal
// default instead.
function rollTriggerSessionsBeforeExpiry(
  structureId: string,
  rules: readonly ExitRule[],
): number | null {
  if (!ROLLABLE_STRUCTURE_IDS.has(structureId)) {
    return null;
  }
  const daysBeforeRule = rules.find((rule) => rule.kind === "days_before_expiry");
  return daysBeforeRule?.kind === "days_before_expiry"
    ? daysBeforeRule.businessDays
    : DEFAULT_ROLL_SESSIONS_BEFORE_EXPIRY;
}

// The structure's roll rule: it applies only to a rollable structure, at the date its own
// `days_before_expiry` exit rule names, or a default of five sessions before expiry when it
// states none.
export function resolveRollRule(
  structureId: string,
  rules: readonly ExitRule[],
  sessionsBeforeExpiry: (businessDays: number) => SessionDate | null,
): RollRule {
  const businessDays = rollTriggerSessionsBeforeExpiry(structureId, rules);
  if (businessDays === null) {
    return { applies: false, session: null };
  }
  return { applies: true, session: sessionsBeforeExpiry(businessDays) };
}
