import { sessionDateSchema, type SessionDate } from "@fetha/contracts";

const TIME_ZONE = "America/Sao_Paulo";

const isoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// "Today" as a plain calendar date in São Paulo (CLAUDE.md formatting: the
// app's one time zone), mirroring market-data/close-freshness.ts's own
// isoDateInSaoPaulo (kept module-private there, so re-derived here rather
// than imported across the boundary). A horizon is compared against this,
// never against a bare `new Date()` day: for the hours between UTC midnight
// and São Paulo midnight (21:00-24:00 UTC, since Brazil dropped DST in
// 2019 and the offset is a fixed UTC-3), that would read "today" as a day
// that has not started yet in São Paulo.
export function todaySaoPauloDate(now: Date = new Date()): SessionDate {
  return sessionDateSchema.parse(isoDateFormatter.format(now));
}
