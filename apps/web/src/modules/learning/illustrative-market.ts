import {
  decimalStringSchema,
  instantSchema,
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
  type DecimalString,
  type IllustrativeExampleId,
  type RecipeStructureId,
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
export const ILLUSTRATIVE_LOWEST_STRIKE: DecimalString = decimalStringSchema.parse("18.00");
export const ILLUSTRATIVE_LOWER_STRIKE: DecimalString = decimalStringSchema.parse("20.00");
export const ILLUSTRATIVE_LOWER_MID_STRIKE: DecimalString = decimalStringSchema.parse("19.00");
export const ILLUSTRATIVE_UPPER_MID_STRIKE: DecimalString = decimalStringSchema.parse("21.00");
export const ILLUSTRATIVE_HIGHER_STRIKE: DecimalString = decimalStringSchema.parse("22.00");
// Every premium below is the Black-Scholes price (ADR-0002) of its own strike, from one flat
// annualized vol (50%) and r=0 (no CDI point in this fixture's market view resolves to the
// engine's own default, `resolveRiskFreeRate`), at this fixture's own T = 36/252 years (35
// trading sessions strictly after `AT`'s session up to and including `ILLUSTRATIVE_EXPIRY`, plus
// the whole of `AT`'s own session, ADR-0013's day-count rule) — never chosen by hand, derived
// once with `bsmPriceRaw` (`packages/engine/src/internal/black-scholes.ts`) from inside the
// engine package and rounded to the cent, so put-call parity (`C - P = S - K` at r=0) holds
// across every strike (review round 2, finding #3). Flat vol means the lessons' own IV-rank
// lesson never cites these as evidence of a skew or a term structure.
export const ILLUSTRATIVE_CALL_PREMIUM: DecimalString = decimalStringSchema.parse("1.51");
export const ILLUSTRATIVE_HIGHER_CALL_PREMIUM: DecimalString = decimalStringSchema.parse("0.78");
export const ILLUSTRATIVE_PUT_PREMIUM: DecimalString = decimalStringSchema.parse("1.51");
export const ILLUSTRATIVE_LOWEST_CALL_PREMIUM: DecimalString = decimalStringSchema.parse("2.65");
export const ILLUSTRATIVE_UPPER_MID_CALL_PREMIUM: DecimalString = decimalStringSchema.parse("1.09");
export const ILLUSTRATIVE_LOWEST_PUT_PREMIUM: DecimalString = decimalStringSchema.parse("0.65");
export const ILLUSTRATIVE_LOWER_MID_PUT_PREMIUM: DecimalString = decimalStringSchema.parse("1.02");
export const ILLUSTRATIVE_HIGHER_PUT_PREMIUM: DecimalString = decimalStringSchema.parse("2.78");

const AT = instantSchema.parse("2026-01-02T13:00:00.000Z");
const CALENDAR_START = "2026-01-02";
const CALENDAR_SESSIONS = 60;

// February's call letter is B, its put letter N (series-code.ts); the
// trailing number is a made-up sequence number, deliberately not the
// strike (20.00/22.00), the mistake the reading-the-series-code lesson
// warns against.
const CALL_LOWEST_TICKER: Ticker = tickerSchema.parse("EXMPB130");
const CALL_LOWER_TICKER: Ticker = tickerSchema.parse("EXMPB105");
const CALL_UPPER_MID_TICKER: Ticker = tickerSchema.parse("EXMPB140");
const CALL_HIGHER_TICKER: Ticker = tickerSchema.parse("EXMPB112");
const PUT_LOWEST_TICKER: Ticker = tickerSchema.parse("EXMPN130");
const PUT_LOWER_MID_TICKER: Ticker = tickerSchema.parse("EXMPN135");
const PUT_LOWER_TICKER: Ticker = tickerSchema.parse("EXMPN105");
const PUT_HIGHER_TICKER: Ticker = tickerSchema.parse("EXMPN112");

// A trading calendar never includes Saturday or Sunday (B3 never opens on either): the fixed
// illustrative market follows that rule too, so the sessions-to-expiry figure a lesson shows is
// the real count of trading days between two dates, not the calendar day count a naive walk
// would give (review round 2, finding #3).
function dailySessions(startDate: string, count: number): TradingSession[] {
  const sessions: TradingSession[] = [];
  let cursor = new Date(`${startDate}T00:00:00.000Z`);
  while (sessions.length < count) {
    const dayOfWeek = cursor.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      const date = sessionDateSchema.parse(cursor.toISOString().slice(0, 10));
      sessions.push({
        date,
        open: instantSchema.parse(`${date}T13:00:00.000Z`),
        close: instantSchema.parse(`${date}T21:00:00.000Z`),
      });
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return sessions;
}

// Exported so a test can decode every series' own ticker against its own
// right, expiry and strike, instead of only the single-leg examples
// `loadIllustrativeExamples` happens to expose a ticker for.
export const ILLUSTRATIVE_OPTION_SERIES = [
  {
    ticker: CALL_LOWEST_TICKER,
    underlying: ILLUSTRATIVE_UNDERLYING,
    right: "call" as const,
    strike: ILLUSTRATIVE_LOWEST_STRIKE,
    expiry: ILLUSTRATIVE_EXPIRY,
    style: "european" as const,
    asOf: AT,
  },
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
    ticker: CALL_UPPER_MID_TICKER,
    underlying: ILLUSTRATIVE_UNDERLYING,
    right: "call" as const,
    strike: ILLUSTRATIVE_UPPER_MID_STRIKE,
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
    ticker: PUT_LOWEST_TICKER,
    underlying: ILLUSTRATIVE_UNDERLYING,
    right: "put" as const,
    strike: ILLUSTRATIVE_LOWEST_STRIKE,
    expiry: ILLUSTRATIVE_EXPIRY,
    style: "european" as const,
    asOf: AT,
  },
  {
    ticker: PUT_LOWER_MID_TICKER,
    underlying: ILLUSTRATIVE_UNDERLYING,
    right: "put" as const,
    strike: ILLUSTRATIVE_LOWER_MID_STRIKE,
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
  {
    ticker: PUT_HIGHER_TICKER,
    underlying: ILLUSTRATIVE_UNDERLYING,
    right: "put" as const,
    strike: ILLUSTRATIVE_HIGHER_STRIKE,
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

const bullPutSpreadLegs: LegInput[] = [
  {
    role: "put",
    side: "buy",
    ticker: PUT_LOWER_MID_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_LOWER_MID_PUT_PREMIUM,
  },
  {
    role: "put",
    side: "sell",
    ticker: PUT_LOWER_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_PUT_PREMIUM,
  },
];

const bearCallSpreadLegs: LegInput[] = [
  {
    role: "call",
    side: "sell",
    ticker: CALL_LOWER_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_CALL_PREMIUM,
  },
  {
    role: "call",
    side: "buy",
    ticker: CALL_HIGHER_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_HIGHER_CALL_PREMIUM,
  },
];

const bearPutSpreadLegs: LegInput[] = [
  {
    role: "put",
    side: "sell",
    ticker: PUT_LOWER_MID_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_LOWER_MID_PUT_PREMIUM,
  },
  {
    role: "put",
    side: "buy",
    ticker: PUT_LOWER_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_PUT_PREMIUM,
  },
];

const coveredCallLegs: LegInput[] = [
  {
    role: "stock",
    side: "buy",
    ticker: ILLUSTRATIVE_UNDERLYING,
    quantity: quantitySchema.parse(1),
  },
  {
    role: "call",
    side: "sell",
    ticker: CALL_HIGHER_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_HIGHER_CALL_PREMIUM,
  },
];

const callButterflyLegs: LegInput[] = [
  {
    role: "call",
    side: "buy",
    ticker: CALL_LOWEST_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_LOWEST_CALL_PREMIUM,
  },
  {
    role: "call",
    side: "sell",
    ticker: CALL_LOWER_TICKER,
    quantity: quantitySchema.parse(2),
    price: ILLUSTRATIVE_CALL_PREMIUM,
  },
  {
    role: "call",
    side: "buy",
    ticker: CALL_HIGHER_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_HIGHER_CALL_PREMIUM,
  },
];

const putButterflyLegs: LegInput[] = [
  {
    role: "put",
    side: "buy",
    ticker: PUT_LOWEST_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_LOWEST_PUT_PREMIUM,
  },
  {
    role: "put",
    side: "sell",
    ticker: PUT_LOWER_TICKER,
    quantity: quantitySchema.parse(2),
    price: ILLUSTRATIVE_PUT_PREMIUM,
  },
  {
    role: "put",
    side: "buy",
    ticker: PUT_HIGHER_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_HIGHER_PUT_PREMIUM,
  },
];

const ironCondorLegs: LegInput[] = [
  {
    role: "put",
    side: "buy",
    ticker: PUT_LOWEST_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_LOWEST_PUT_PREMIUM,
  },
  {
    role: "put",
    side: "sell",
    ticker: PUT_LOWER_MID_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_LOWER_MID_PUT_PREMIUM,
  },
  {
    role: "call",
    side: "sell",
    ticker: CALL_UPPER_MID_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_UPPER_MID_CALL_PREMIUM,
  },
  {
    role: "call",
    side: "buy",
    ticker: CALL_HIGHER_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_HIGHER_CALL_PREMIUM,
  },
];

const longStraddleLegs: LegInput[] = [
  {
    role: "call",
    side: "buy",
    ticker: CALL_LOWER_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_CALL_PREMIUM,
  },
  {
    role: "put",
    side: "buy",
    ticker: PUT_LOWER_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_PUT_PREMIUM,
  },
];

const longStrangleLegs: LegInput[] = [
  {
    role: "put",
    side: "buy",
    ticker: PUT_LOWER_MID_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_LOWER_MID_PUT_PREMIUM,
  },
  {
    role: "call",
    side: "buy",
    ticker: CALL_UPPER_MID_TICKER,
    quantity: quantitySchema.parse(1),
    price: ILLUSTRATIVE_UPPER_MID_CALL_PREMIUM,
  },
];

// `illustrativeLegs`' own test checks these match the catalog's legs exactly
// (ratio, role, side), keyed by the same `RecipeStructureId` the lesson
// catalog's own `structure` field uses (`@fetha/contracts`) rather than a
// second, separately maintained union. Writing a naked call is deliberately
// absent from the strategy catalog (ADR-0064 only lists structures a
// backtest can size), so `shortCallLegs` below is built directly instead of
// going through this map.
export const illustrativeLegs: Record<RecipeStructureId, readonly LegInput[]> = {
  "long-call": longCallLegs,
  "long-put": longPutLegs,
  "bull-call-spread": bullCallSpreadLegs,
  "bull-put-spread": bullPutSpreadLegs,
  "bear-call-spread": bearCallSpreadLegs,
  "bear-put-spread": bearPutSpreadLegs,
  "covered-call": coveredCallLegs,
  "call-butterfly": callButterflyLegs,
  "put-butterfly": putButterflyLegs,
  "iron-condor": ironCondorLegs,
  "long-straddle": longStraddleLegs,
  "long-strangle": longStrangleLegs,
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
  lowestStrike: DecimalString;
  lowerStrike: DecimalString;
  lowerMidStrike: DecimalString;
  upperMidStrike: DecimalString;
  higherStrike: DecimalString;
  "long-call": OperationPricing;
  "long-put": OperationPricing;
  "short-call": OperationPricing;
  "bull-call-spread": OperationPricing;
  "bull-put-spread": OperationPricing;
  "bear-call-spread": OperationPricing;
  "bear-put-spread": OperationPricing;
  "covered-call": OperationPricing;
  "call-butterfly": OperationPricing;
  "put-butterfly": OperationPricing;
  "iron-condor": OperationPricing;
  "long-straddle": OperationPricing;
  "long-strangle": OperationPricing;
}

// Server-side, deterministic, no DB: resolved once per render of a lesson's
// payoff-example blocks (learning/catalog.ts).
export async function loadIllustrativeExamples(): Promise<IllustrativeExamples> {
  const [
    longCall,
    longPut,
    shortCall,
    bullCallSpread,
    bullPutSpread,
    bearCallSpread,
    bearPutSpread,
    coveredCall,
    callButterfly,
    putButterfly,
    ironCondor,
    longStraddle,
    longStrangle,
  ] = await Promise.all([
    priceIllustrative(longCallLegs),
    priceIllustrative(longPutLegs),
    priceIllustrative(shortCallLegs),
    priceIllustrative(bullCallSpreadLegs),
    priceIllustrative(bullPutSpreadLegs),
    priceIllustrative(bearCallSpreadLegs),
    priceIllustrative(bearPutSpreadLegs),
    priceIllustrative(coveredCallLegs),
    priceIllustrative(callButterflyLegs),
    priceIllustrative(putButterflyLegs),
    priceIllustrative(ironCondorLegs),
    priceIllustrative(longStraddleLegs),
    priceIllustrative(longStrangleLegs),
  ]);

  return {
    underlying: ILLUSTRATIVE_UNDERLYING,
    spot: ILLUSTRATIVE_SPOT,
    lowestStrike: ILLUSTRATIVE_LOWEST_STRIKE,
    lowerStrike: ILLUSTRATIVE_LOWER_STRIKE,
    lowerMidStrike: ILLUSTRATIVE_LOWER_MID_STRIKE,
    upperMidStrike: ILLUSTRATIVE_UPPER_MID_STRIKE,
    higherStrike: ILLUSTRATIVE_HIGHER_STRIKE,
    "long-call": longCall,
    "long-put": longPut,
    "short-call": shortCall,
    "bull-call-spread": bullCallSpread,
    "bull-put-spread": bullPutSpread,
    "bear-call-spread": bearCallSpread,
    "bear-put-spread": bearPutSpread,
    "covered-call": coveredCall,
    "call-butterfly": callButterfly,
    "put-butterfly": putButterfly,
    "iron-condor": ironCondor,
    "long-straddle": longStraddle,
    "long-strangle": longStrangle,
  };
}
