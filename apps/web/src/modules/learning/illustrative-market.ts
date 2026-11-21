import {
  decimalStringSchema,
  instantSchema,
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
  type DecimalString,
  type IllustrativeExampleId,
  type SessionDate,
  type Ticker,
} from "@fetha/contracts";
import {
  engine,
  type LegInput,
  type MarketView,
  type OperationPricing,
  type TradingSession,
} from "@fetha/engine";

// A fixed, fictitious market so every number a lesson shows is real engine
// output (CLAUDE.md principle 1) without ever touching the database: a made-up
// underlying, a made-up option chain and given leg prices, never resolved
// from a solve or a lookback. The dates and prices never change, so every
// example below is deterministic across runs. Moved from
// `modules/help/options-101.ts` (the "Options in 10 minutes" section it fed
// now lives as lessons here) and extended with the short call this module's
// lessons also need.
export const ILLUSTRATIVE_UNDERLYING: Ticker = tickerSchema.parse("EXMP3");
export const ILLUSTRATIVE_SPOT: DecimalString = decimalStringSchema.parse("20.00");
const ILLUSTRATIVE_EXPIRY: SessionDate = sessionDateSchema.parse("2026-02-20");
export const ILLUSTRATIVE_LOWER_STRIKE: DecimalString = decimalStringSchema.parse("20.00");
export const ILLUSTRATIVE_HIGHER_STRIKE: DecimalString = decimalStringSchema.parse("22.00");
export const ILLUSTRATIVE_CALL_PREMIUM: DecimalString = decimalStringSchema.parse("1.50");
export const ILLUSTRATIVE_HIGHER_CALL_PREMIUM: DecimalString = decimalStringSchema.parse("0.60");
export const ILLUSTRATIVE_PUT_PREMIUM: DecimalString = decimalStringSchema.parse("1.20");

const AT = instantSchema.parse("2026-01-02T13:00:00.000Z");
const CALENDAR_START = "2026-01-02";
const CALENDAR_SESSIONS = 60;

// February's call letter is B, its put letter N (series-code.ts); the
// trailing number is a made-up sequence number, deliberately not the
// strike (20.00/22.00), the mistake the reading-the-series-code lesson
// warns against.
const CALL_LOWER_TICKER: Ticker = tickerSchema.parse("EXMPB105");
const CALL_HIGHER_TICKER: Ticker = tickerSchema.parse("EXMPB112");
const PUT_LOWER_TICKER: Ticker = tickerSchema.parse("EXMPN105");

function dailySessions(startDate: string, count: number): TradingSession[] {
  const sessions: TradingSession[] = [];
  let cursor = new Date(`${startDate}T00:00:00.000Z`);
  for (let i = 0; i < count; i += 1) {
    const date = sessionDateSchema.parse(cursor.toISOString().slice(0, 10));
    sessions.push({
      date,
      open: instantSchema.parse(`${date}T13:00:00.000Z`),
      close: instantSchema.parse(`${date}T21:00:00.000Z`),
    });
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return sessions;
}

// Exported so a test can decode every series' own ticker against its own
// right, expiry and strike, instead of only the single-leg examples
// `loadIllustrativeExamples` happens to expose a ticker for.
export const ILLUSTRATIVE_OPTION_SERIES = [
  {
    ticker: CALL_LOWER_TICKER,
    underlying: ILLUSTRATIVE_UNDERLYING,
    right: "call" as const,
    strike: ILLUSTRATIVE_LOWER_STRIKE,
    expiry: ILLUSTRATIVE_EXPIRY,
    style: "european" as const,
    asOf: AT,
  },
  {
    ticker: CALL_HIGHER_TICKER,
    underlying: ILLUSTRATIVE_UNDERLYING,
    right: "call" as const,
    strike: ILLUSTRATIVE_HIGHER_STRIKE,
    expiry: ILLUSTRATIVE_EXPIRY,
    style: "european" as const,
    asOf: AT,
  },
  {
    ticker: PUT_LOWER_TICKER,
    underlying: ILLUSTRATIVE_UNDERLYING,
    right: "put" as const,
    strike: ILLUSTRATIVE_LOWER_STRIKE,
    expiry: ILLUSTRATIVE_EXPIRY,
    style: "european" as const,
    asOf: AT,
  },
];

const ILLUSTRATIVE_VIEW: MarketView = {
  calendar: dailySessions(CALENDAR_START, CALENDAR_SESSIONS),
  candles: [],
  corporateActions: [],
  optionSeries: ILLUSTRATIVE_OPTION_SERIES,
  optionPrices: [],
  quotes: [
    { ticker: ILLUSTRATIVE_UNDERLYING, asOf: AT, last: ILLUSTRATIVE_SPOT, bid: null, ask: null },
  ],
  macro: [],
  dividendYields: [],
  impliedVolatilityIndex: [],
};

const longCallLegs: LegInput[] = [
  {
    role: "call",
    side: "buy",
    ticker: CALL_LOWER_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_CALL_PREMIUM,
  },
];

const shortCallLegs: LegInput[] = [
  {
    role: "call",
    side: "sell",
    ticker: CALL_LOWER_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_CALL_PREMIUM,
  },
];

const longPutLegs: LegInput[] = [
  {
    role: "put",
    side: "buy",
    ticker: PUT_LOWER_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_PUT_PREMIUM,
  },
];

const bullCallSpreadLegs: LegInput[] = [
  {
    role: "call",
    side: "buy",
    ticker: CALL_LOWER_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_CALL_PREMIUM,
  },
  {
    role: "call",
    side: "sell",
    ticker: CALL_HIGHER_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_HIGHER_CALL_PREMIUM,
  },
];

// Ids of structures the catalog also defines; `illustrativeLegs`' own test
// checks these match the catalog's legs exactly (ratio, role, side). Writing
// a naked call is deliberately absent from the strategy catalog (ADR-0064
// only lists structures a backtest can size), so `shortCallLegs` below is
// built directly instead of going through this map.
export type StructureId = "long-call" | "long-put" | "bull-call-spread";

export const illustrativeLegs: Record<StructureId, readonly LegInput[]> = {
  "long-call": longCallLegs,
  "long-put": longPutLegs,
  "bull-call-spread": bullCallSpreadLegs,
};

async function priceIllustrative(legs: LegInput[]): Promise<OperationPricing> {
  const result = await engine.priceOperation({ view: ILLUSTRATIVE_VIEW, at: AT, legs });
  if (!result.ok) {
    throw new Error(`illustrative-market pricing failed: ${result.error.code}`);
  }
  return result.value;
}

export type { IllustrativeExampleId };

export interface IllustrativeExamples {
  underlying: Ticker;
  spot: DecimalString;
  lowerStrike: DecimalString;
  higherStrike: DecimalString;
  "long-call": OperationPricing;
  "long-put": OperationPricing;
  "short-call": OperationPricing;
  "bull-call-spread": OperationPricing;
}

// Server-side, deterministic, no DB: resolved once per render of a lesson's
// payoff-example blocks (learning/catalog.ts).
export async function loadIllustrativeExamples(): Promise<IllustrativeExamples> {
  const [longCall, longPut, shortCall, bullCallSpread] = await Promise.all([
    priceIllustrative(longCallLegs),
    priceIllustrative(longPutLegs),
    priceIllustrative(shortCallLegs),
    priceIllustrative(bullCallSpreadLegs),
  ]);

  return {
    underlying: ILLUSTRATIVE_UNDERLYING,
    spot: ILLUSTRATIVE_SPOT,
    lowerStrike: ILLUSTRATIVE_LOWER_STRIKE,
    higherStrike: ILLUSTRATIVE_HIGHER_STRIKE,
    "long-call": longCall,
    "long-put": longPut,
    "short-call": shortCall,
    "bull-call-spread": bullCallSpread,
  };
}
