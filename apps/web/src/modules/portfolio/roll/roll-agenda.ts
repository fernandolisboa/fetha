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
  // Whether the operation carries a short leg at all (a stock-only or long-only position never
  // gets `let_expire`: B3 auto-exercises an in-the-money long on the holder's behalf, so a
  // long-only position always needs a human look, never a computed "nothing to do" (#382)).
  hasShortLeg: boolean;
  // True once any short leg (the one a buyer could exercise) is in the money at the last close:
  // the literal strike-vs-spot comparison plus its assignment-risk band
  // (`roll/roll-assignment-risk.ts`), never the display moneyness a series picker shows with its
  // own at-the-money band.
  anyShortLegInTheMoney: boolean;
  // True once any long leg (the one the holder could exercise, or B3 auto-exercises) is in the
  // money at the last close: `let_expire` is wrong advice while a long leg would actually settle
  // in cash or stock rather than expire worthless.
  anyLongLegInTheMoney: boolean;
  // False when the last close or a leg's series facts were not available to compute the two
  // moneyness flags above: the agenda still lists the operation, but can only ever watch it, not
  // claim it is safe to let expire.
  moneynessKnown: boolean;
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
// 3. Otherwise, "let it expire" applies only when the operation has a short leg, every short leg
//    is out of the money and no long leg is in the money: a short leg still in the money (but
//    short of the assignment-risk window), a long-only position, or a long leg B3 would
//    auto-exercise, are all only watched instead.
// 4. Moneyness the agenda could not compute (a missing candle or missing series facts) is never
//    treated as "out of the money": it is watched, the same as an unresolved short leg.
//
// Returns null when the operation is outside the agenda window (CLAUDE.md: the engine computes,
// nothing here guesses a number) or carries no expiry to plan around.
export function suggestRollAction(input: RollAgendaInput): RollAgendaItem | null {
  if (input.sessionsToExpiry > ROLL_AGENDA_WINDOW_SESSIONS || input.sessionsToExpiry < 0) {
    return null;
  }
  const action: RollAgendaAction =
    input.moneynessKnown &&
    input.anyShortLegInTheMoney &&
    input.sessionsToExpiry <= ASSIGNMENT_RISK_SESSIONS
      ? "close_early_assignment_risk"
      : input.rollTriggerSessions !== null && input.sessionsToExpiry <= input.rollTriggerSessions
        ? "roll"
        : input.moneynessKnown &&
            input.hasShortLeg &&
            !input.anyShortLegInTheMoney &&
            !input.anyLongLegInTheMoney
          ? "let_expire"
          : "watch";
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
