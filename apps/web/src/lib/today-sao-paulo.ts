import { sessionDateSchema, type SessionDate } from "@fetha/contracts";

const TIME_ZONE = "America/Sao_Paulo";

const isoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// "Today" as a plain calendar date in São Paulo, the app's one time zone.
// A bare `new Date()` day would read "today" as a day that has not started
// yet in São Paulo between 21:00 and 24:00 UTC (fixed UTC-3 since Brazil
// dropped DST in 2019).
export function todaySaoPauloDate(now: Date = new Date()): SessionDate {
  return sessionDateSchema.parse(isoDateFormatter.format(now));
}
