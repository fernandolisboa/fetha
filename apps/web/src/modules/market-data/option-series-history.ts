import {
  decimalStringSchema,
  exerciseStyleSchema,
  instantSchema,
  macroSeriesKindSchema,
  optionRightSchema,
  quantitySchema,
  sessionDateSchema,
  settlementStyleSchema,
  tickerSchema,
  type DecimalString,
  type Instant,
  type OptionRight,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";
import {
  engine,
  type MacroPoint,
  type MarketView,
  type NoteCode,
  type OptionDayPrice,
  type OptionSeries,
} from "@fetha/engine";

import type { Database } from "@/db/client";

import {
  emptyMarketView,
  latestSeriesRowByTicker,
  priceMatchesEpoch,
  toEngineCandle,
  toEngineCorporateActions,
  toTradingSession,
} from "./market-view";
import { sessionsInRange } from "./repositories/calendar-repository";
import { candlesInSessionRange, type CandleRow } from "./repositories/candle-repository";
import {
  corporateActionsForTicker,
  type CorporateActionFactorRow,
} from "./repositories/corporate-action-repository";
import { macroPointsInRange } from "./repositories/macro-repository";
import {
  optionPricesForCycle,
  optionSeriesEpochsForCycle,
  type OptionSeriesEpochRow,
} from "./repositories/option-repository";
import type { optionDailyPrices } from "./schema";

export const OPTION_SERIES_HISTORY_SESSIONS = 60;

// A CDI point is visible from the next session's open (ADR-0054), so the rate behind the first
// plotted session can sit a few calendar days (a long holiday weekend) before it.
const CDI_LOOKBACK_DAYS = 10;

const ONE_CONTRACT = quantitySchema.parse(1);

const UNRELIABLE_SOLVE_NOTES: ReadonlySet<NoteCode> = new Set([
  "risk_free_rate_defaulted",
  "option_strike_unadjusted_across_corporate_action",
]);

export interface OptionSeriesHistoryPoint {
  session: SessionDate;
  close: DecimalString | null;
  underlyingClose: DecimalString | null;
  impliedVolatility: DecimalString | null;
}

export interface OptionSeriesHistoryTarget {
  ticker: Ticker;
  underlying: Ticker;
  right: OptionRight;
  expiry: SessionDate;
}

type PriceRow = typeof optionDailyPrices.$inferSelect;
type CalendarRow = { date: string; open: Date; close: Date };
type MacroRow = { series: string; date: string; asOf: Date; annualRate: string };

export interface OptionSeriesHistoryRows {
  epochs: OptionSeriesEpochRow[];
  prices: PriceRow[];
  candles: CandleRow[];
  calendar: CalendarRow[];
  macro: MacroRow[];
  corporateActions: CorporateActionFactorRow[];
}

function lookbackStart(session: string): string {
  const start = new Date(`${session}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - CDI_LOOKBACK_DAYS);
  return start.toISOString().slice(0, 10);
}

// One view for the whole history: the engine reads every collection point-in-time off the
// `at` it is given, so the same view prices each session without leaking a later row.
export function assembleOptionSeriesHistoryView(rows: OptionSeriesHistoryRows): MarketView {
  const optionSeries: OptionSeries[] = rows.epochs.map((row) => ({
    ticker: tickerSchema.parse(row.ticker),
    underlying: tickerSchema.parse(row.underlying),
    right: optionRightSchema.parse(row.right),
    strike: decimalStringSchema.parse(row.strike),
    expiry: sessionDateSchema.parse(row.expiry),
    style: exerciseStyleSchema.parse(row.style),
    asOf: instantSchema.parse(row.asOf.toISOString()),
    priceFactor: decimalStringSchema.parse(row.priceFactor),
    settlementStyle: settlementStyleSchema.parse(row.settlementStyle),
  }));

  const optionPrices: OptionDayPrice[] = rows.prices.map((row) => ({
    ticker: tickerSchema.parse(row.ticker),
    session: sessionDateSchema.parse(row.session),
    asOf: instantSchema.parse(row.asOf.toISOString()),
    average: row.average ? decimalStringSchema.parse(row.average) : null,
    close: row.close ? decimalStringSchema.parse(row.close) : null,
    trades: row.trades,
    tradedQuantity: row.tradedQuantity,
  }));

  // `macroPointsInRange` arrives newest first, so keeping the first row per `asOf` keeps the
  // fresher observation; the engine rejects two CDI points sharing one `asOf` outright.
  const seenAsOf = new Set<string>();
  const macro: MacroPoint[] = [];
  for (const row of rows.macro) {
    const key = row.asOf.toISOString();
    if (row.series !== "cdi" || seenAsOf.has(key)) continue;
    seenAsOf.add(key);
    macro.push({
      series: macroSeriesKindSchema.parse(row.series),
      date: sessionDateSchema.parse(row.date),
      asOf: instantSchema.parse(key),
      annualRate: decimalStringSchema.parse(row.annualRate),
    });
  }

  return {
    ...emptyMarketView(),
    calendar: rows.calendar.map(toTradingSession),
    candles: rows.candles.map(toEngineCandle),
    corporateActions: toEngineCorporateActions(rows.corporateActions),
    optionSeries,
    optionPrices,
    macro,
  };
}

// The series' implied volatility at one session's close, solved by the engine from that
// session's own price. Unavailable (null) rather than approximated when the price is stale,
// the rate fell back to 0 or the strike may not reflect a corporate action: a number solved
// from a wrong input would bake into the chart (docs/adr/0054 draws the same line for the IV
// index).
async function impliedVolatilityAt(
  view: MarketView,
  target: OptionSeriesHistoryTarget,
  at: Instant,
): Promise<DecimalString | null> {
  const result = await engine.priceOperation({
    view,
    at,
    legs: [{ role: target.right, side: "buy", ticker: target.ticker, quantity: ONE_CONTRACT }],
  });
  if (!result.ok) return null;
  const leg = result.value.legs[0];
  if (!leg || leg.impliedVolatility === null || leg.stale !== null) return null;
  const notes = [...result.value.notes, ...leg.notes];
  if (notes.some((note) => UNRELIABLE_SOLVE_NOTES.has(note.code))) return null;
  return leg.impliedVolatility;
}

export async function computeOptionSeriesHistory(
  target: OptionSeriesHistoryTarget,
  rows: OptionSeriesHistoryRows,
): Promise<OptionSeriesHistoryPoint[]> {
  const view = assembleOptionSeriesHistoryView(rows);
  const underlyingCloseBySession = new Map(
    view.candles
      .filter((candle) => candle.ticker === target.underlying)
      .map((candle) => [candle.session, candle.close]),
  );
  const closeBySession = new Map(rows.calendar.map((day) => [day.date, day.close]));
  const ordered = [...rows.prices].reverse();
  return Promise.all(
    ordered.map(async (row) => {
      const session = sessionDateSchema.parse(row.session);
      const underlyingClose = underlyingCloseBySession.get(session) ?? null;
      const at = closeBySession.get(session);
      // Solved only against that session's own spot (the engine would otherwise carry an older
      // close forward) and only when the price was recorded under the strike the engine prices
      // at that close: the latest visible epoch, the same rule the operation view applies (#274).
      const solvable =
        underlyingClose !== null &&
        at !== undefined &&
        priceMatchesEpoch(
          row,
          latestSeriesRowByTicker(rows.epochs.filter((epoch) => epoch.asOf <= at)).get(row.ticker),
        );
      return {
        session,
        close: row.close ? decimalStringSchema.parse(row.close) : null,
        underlyingClose,
        impliedVolatility: solvable
          ? await impliedVolatilityAt(view, target, instantSchema.parse(at.toISOString()))
          : null,
      };
    }),
  );
}

// The last `sessions` sessions the series has a price row for, oldest first: its close, the
// underlying's close on the same session and the implied volatility the engine solves from the
// close. A fixed number of queries whatever the window, never one per session.
export async function optionSeriesHistory(
  db: Database,
  target: OptionSeriesHistoryTarget,
  sessions = OPTION_SERIES_HISTORY_SESSIONS,
): Promise<OptionSeriesHistoryPoint[]> {
  const prices = await optionPricesForCycle(db, target.ticker, target.expiry, sessions);
  const oldest = prices.at(-1)?.session;
  const newest = prices[0]?.session;
  if (!oldest || !newest) return [];

  const [epochs, candles, calendar, macro, corporateActions] = await Promise.all([
    optionSeriesEpochsForCycle(db, target.ticker, target.expiry),
    candlesInSessionRange(db, [target.underlying], oldest, newest),
    sessionsInRange(
      db,
      new Date(`${oldest}T00:00:00.000Z`),
      new Date(`${target.expiry}T23:59:59.999Z`),
    ),
    macroPointsInRange(db, lookbackStart(oldest), newest),
    corporateActionsForTicker(db, target.underlying),
  ]);

  return computeOptionSeriesHistory(target, {
    epochs,
    prices,
    candles,
    calendar,
    macro,
    corporateActions,
  });
}
