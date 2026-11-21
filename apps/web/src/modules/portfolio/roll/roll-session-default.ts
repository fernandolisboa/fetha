import type { SessionDate } from "@fetha/contracts";

// The roll dialog's own default execution session (#382, ADR-0080): today, when today has a
// trading session and it has already opened, since `recordRollAction`'s own "not a session"
// guard (`executionSession.open > nowInstant()`) refuses a session before its own open instant,
// not merely a non-trading day. Falls back to the latest session that has already opened — a
// weekend or a holiday never has one of its own, and a weekday before B3's open has not opened
// yet either — so the field never defaults to a date that guard would refuse outright. The
// dialog's own `max` stays the literal calendar today, unaffected by this fallback.
export function resolveRollSessionDefault(
  today: SessionDate,
  todaySession: { open: Date } | null,
  now: Date,
  latestOpenedSession: SessionDate | null,
): SessionDate {
  if (todaySession && todaySession.open <= now) {
    return today;
  }
  return latestOpenedSession ?? today;
}
