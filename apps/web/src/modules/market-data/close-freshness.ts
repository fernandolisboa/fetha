import type { SessionDate } from "@fetha/contracts";

import { todaySaoPauloDate } from "@/lib/today-sao-paulo";

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

export type CloseFreshness =
  { kind: "today" } | { kind: "yesterday" } | { kind: "older"; session: SessionDate };

// A typed close-freshness state (DESIGN.md's "Stale" state, "fechamento de
// ontem"): the session is a plain calendar date (SessionDate), so
// "today"/"yesterday" compare calendar days in America/Sao_Paulo rather
// than elapsed hours. Kept free of copy so a client component can recompute
// it against a live `now` (an installed PWA left open past midnight) and
// render the pt-BR phrase from `shell/strings.ts` itself.
export function closeFreshnessKind(session: SessionDate, now: Date = new Date()): CloseFreshness {
  const today = todaySaoPauloDate(now);
  if (session === today) {
    return { kind: "today" };
  }
  if (session === daysBefore(today, 1)) {
    return { kind: "yesterday" };
  }
  return { kind: "older", session };
}

// Session dates are plain calendar dates with no time of day; noon UTC
// keeps the display date from shifting a day when formatted back through
// America/Sao_Paulo.
export function sessionDateToDisplayDate(session: SessionDate): Date {
  const { year, month, day } = parseIsoDate(session);
  return new Date(Date.UTC(year, month - 1, day, 12));
}
