import type { SessionDate, Ticker } from "@fetha/contracts";

// The agenda window (#382): an operation enters the agenda once its expiry is this many
// sessions away or fewer. Beyond that the user has nothing to decide yet.
export const ROLL_AGENDA_WINDOW_SESSIONS = 10;

// Assignment risk is flagged once a short leg is in the money this close to expiry, regardless
// of the structure's own roll rule (ADR-0080): close enough that a broker's automatic exercise
// can land before the user next looks at the app.
const ASSIGNMENT_RISK_SESSIONS = 1;

export type RollAgendaAction = "roll" | "let_expire" | "watch" | "close_early_assignment_risk";

export interface RollAgendaItem {
  operationId: string;
  underlying: Ticker;
  expiry: SessionDate;
  sessionsToExpiry: number;
  action: RollAgendaAction;
}

export interface RollAgendaInput {
  operationId: string;
  underlying: Ticker;
  expiry: SessionDate;
  sessionsToExpiry: number;
  // True once any short leg (the one a buyer could exercise) is in the money at the last close:
  // the literal strike-vs-spot comparison (`roll/roll-assignment-risk.ts`), never the display
  // moneyness a series picker shows with its own at-the-money band.
  anyShortLegInTheMoney: boolean;
  // `rollTriggerSessionsBeforeExpiry` (plans/exit-rules.ts): the business-day count the held
  // structure's own roll rule fires at, or null when the structure does not roll.
  rollTriggerSessions: number | null;
}

// The suggested action for one held operation (#382, documented rule):
//
// 1. A short leg already in the money with one session or fewer to expiry is an assignment-risk
//    operation: closing before expiry beats waiting, whether or not the structure normally rolls.
// 2. Otherwise, a structure that rolls at all, once today's `sessionsToExpiry` reaches its own
//    trigger, is a roll.
// 3. Otherwise, a short leg already in the money (but not yet at the assignment-risk window)
//    is only watched: "let it expire" would be wrong advice for a leg a buyer could still
//    exercise before the trigger fires (#382).
// 4. Otherwise every short leg is out of the money, so the position is left to expire worthless.
//
// Returns null when the operation is outside the agenda window (CLAUDE.md: the engine computes,
// nothing here guesses a number) or carries no expiry to plan around.
export function suggestRollAction(input: RollAgendaInput): RollAgendaItem | null {
  if (input.sessionsToExpiry > ROLL_AGENDA_WINDOW_SESSIONS || input.sessionsToExpiry < 0) {
    return null;
  }
  const action: RollAgendaAction =
    input.anyShortLegInTheMoney && input.sessionsToExpiry <= ASSIGNMENT_RISK_SESSIONS
      ? "close_early_assignment_risk"
      : input.rollTriggerSessions !== null && input.sessionsToExpiry <= input.rollTriggerSessions
        ? "roll"
        : input.anyShortLegInTheMoney
          ? "watch"
          : "let_expire";
  return {
    operationId: input.operationId,
    underlying: input.underlying,
    expiry: input.expiry,
    sessionsToExpiry: input.sessionsToExpiry,
    action,
  };
}

export function buildRollAgenda(items: readonly RollAgendaInput[]): RollAgendaItem[] {
  return items
    .map(suggestRollAction)
    .filter((item): item is RollAgendaItem => item !== null)
    .sort((a, b) => a.sessionsToExpiry - b.sessionsToExpiry);
}
