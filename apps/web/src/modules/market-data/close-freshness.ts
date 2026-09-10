import type { SessionDate } from "@fetha/contracts";

import { formatDate } from "@/lib/format/date-time";

const TIME_ZONE = "America/Sao_Paulo";

const isoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function isoDateInSaoPaulo(date: Date): string {
  return isoDateFormatter.format(date);
}

function parseIsoDate(isoDate: string): { year: number; month: number; day: number } {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  return { year, month, day };
}

// Pure calendar-date arithmetic on an already-resolved plain date: no
// timezone re-interpretation, so it cannot drift a day across the SP/UTC
// offset the way round-tripping through Intl again would.
function daysBefore(isoDate: string, days: number): string {
  const { year, month, day } = parseIsoDate(isoDate);
  const shifted = new Date(Date.UTC(year, month - 1, day - days));
  const yyyy = String(shifted.getUTCFullYear()).padStart(4, "0");
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// The market bar's freshness phrase for a daily close (DESIGN.md's "Stale"
// state, "fechamento de ontem"): the session is a plain calendar date
// (SessionDate), so "today"/"yesterday" compare calendar days in
// America/Sao_Paulo rather than elapsed hours.
export function describeCloseFreshness(session: SessionDate, now: Date = new Date()): string {
  const today = isoDateInSaoPaulo(now);
  if (session === today) {
    return "fechamento de hoje";
  }
  if (session === daysBefore(today, 1)) {
    return "fechamento de ontem";
  }
  const { year, month, day } = parseIsoDate(session);
  return `fechamento de ${formatDate(new Date(Date.UTC(year, month - 1, day, 12)))}`;
}
