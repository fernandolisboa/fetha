import type { SessionDate } from "@fetha/contracts";
import type { MarketView, TradingSession } from "@fetha/engine";

// A loop that walks the calendar backward from a computed weekday must never run unbounded: no
// B3 holiday stretch runs longer than this many calendar days in a row.
const MAX_HOLIDAY_LOOKBACK_DAYS = 10;

function parseDateParts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-");
  return { year: Number(year), month: Number(month), day: Number(day) };
}

function thirdFridayOf(year: number, monthIndex: number): string {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const fridayOffset = (5 - first.getUTCDay() + 7) % 7;
  const day = 1 + fridayOffset + 14;
  return toDateString(new Date(Date.UTC(year, monthIndex, day)));
}

function addDays(date: string, delta: number): string {
  const { year, month, day } = parseDateParts(date);
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + delta);
  return toDateString(next);
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// B3's monthly equity-option expiry: the third Friday of the month, moved to the previous
// trading session when that Friday is not one (a holiday) — rather than a separate holiday
// table, this walks back over the calendar the market view already carries, which
// `buildOperationMarketView` already extends through the chain's furthest listed expiry.
export function isB3MonthlyExpiry(date: SessionDate, calendar: readonly TradingSession[]): boolean {
  const { year, month } = parseDateParts(date);
  const sessions = new Set(calendar.map((session) => session.date));
  let candidate = thirdFridayOf(year, month - 1);
  for (let step = 0; step < MAX_HOLIDAY_LOOKBACK_DAYS && !sessions.has(candidate); step += 1) {
    candidate = addDays(candidate, -1);
  }
  return candidate === date;
}

// The plan's own series rule (ticket #379, round 1 review): never a weekly, so this filters the
// view's option chain down to monthly expiries before the engine ever sees it. A caller passing
// this filtered view to `engine.priceOperation` gets the same engine, with fewer series to pick
// from — no engine internal is touched.
export function filterToMonthlyExpiries(view: MarketView): MarketView {
  return {
    ...view,
    optionSeries: view.optionSeries.filter((series) =>
      isB3MonthlyExpiry(series.expiry, view.calendar),
    ),
  };
}
