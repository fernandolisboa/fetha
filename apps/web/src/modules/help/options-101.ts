import {
  decimalStringSchema,
  instantSchema,
  quantitySchema,
  sessionDateSchema,
  tickerSchema,
  type DecimalString,
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

// A fixed, fictitious market so the guide's payoff diagrams are real engine
// output (CLAUDE.md principle 1) without ever touching the database: a made-up
// underlying, a made-up option chain and given leg prices, never resolved
// from a solve or a lookback. The dates and prices never change, so the three
// examples below are deterministic across runs.
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

const CALL_LOWER_TICKER: Ticker = tickerSchema.parse("EXMPC20");
const CALL_HIGHER_TICKER: Ticker = tickerSchema.parse("EXMPC22");
const PUT_LOWER_TICKER: Ticker = tickerSchema.parse("EXMPP20");

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

const ILLUSTRATIVE_VIEW: MarketView = {
  calendar: dailySessions(CALENDAR_START, CALENDAR_SESSIONS),
  candles: [],
  corporateActions: [],
  optionSeries: [
    {
      ticker: CALL_LOWER_TICKER,
      underlying: ILLUSTRATIVE_UNDERLYING,
      right: "call",
      strike: ILLUSTRATIVE_LOWER_STRIKE,
      expiry: ILLUSTRATIVE_EXPIRY,
      style: "european",
      asOf: AT,
    },
    {
      ticker: CALL_HIGHER_TICKER,
      underlying: ILLUSTRATIVE_UNDERLYING,
      right: "call",
      strike: ILLUSTRATIVE_HIGHER_STRIKE,
      expiry: ILLUSTRATIVE_EXPIRY,
      style: "european",
      asOf: AT,
    },
    {
      ticker: PUT_LOWER_TICKER,
      underlying: ILLUSTRATIVE_UNDERLYING,
      right: "put",
      strike: ILLUSTRATIVE_LOWER_STRIKE,
      expiry: ILLUSTRATIVE_EXPIRY,
      style: "european",
      asOf: AT,
    },
  ],
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

export const illustrativeLegs: Record<StructureId, readonly LegInput[]> = {
  "long-call": longCallLegs,
  "long-put": longPutLegs,
  "bull-call-spread": bullCallSpreadLegs,
};

async function priceIllustrative(legs: LegInput[]): Promise<OperationPricing> {
  const result = await engine.priceOperation({ view: ILLUSTRATIVE_VIEW, at: AT, legs });
  if (!result.ok) {
    throw new Error(`options-101 illustrative pricing failed: ${result.error.code}`);
  }
  return result.value;
}

export type StructureId = "long-call" | "long-put" | "bull-call-spread";

export interface Options101Examples {
  underlying: Ticker;
  spot: DecimalString;
  longCall: OperationPricing;
  longPut: OperationPricing;
  bullCallSpread: OperationPricing;
}

// Server-side, deterministic, no DB: called once per render of the "Opções
// em 10 minutos" section (help/components/options-101-section.tsx).
export async function loadOptions101Examples(): Promise<Options101Examples> {
  const [longCall, longPut, bullCallSpread] = await Promise.all([
    priceIllustrative(longCallLegs),
    priceIllustrative(longPutLegs),
    priceIllustrative(bullCallSpreadLegs),
  ]);

  return {
    underlying: ILLUSTRATIVE_UNDERLYING,
    spot: ILLUSTRATIVE_SPOT,
    longCall,
    longPut,
    bullCallSpread,
  };
}
