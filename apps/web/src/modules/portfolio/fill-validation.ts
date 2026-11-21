import type { DecimalString, SessionDate, Ticker } from "@fetha/contracts";
import { sessionDateSchema } from "@fetha/contracts";

import type { Database } from "@/db/client";
import { parseCentavosInput } from "@/lib/format/parse-money";
import {
  isMarketIndex,
  latestCandle,
  optionSeriesForFills,
  seriesKey,
} from "@/modules/market-data";

import { parsePriceInput } from "./parse-price";
import type { FillSide } from "./schema";
import type { NewFill } from "./portfolio-repository";

export interface RawFillAmounts {
  price: string;
  costs: string;
}

export interface FillAmounts {
  price: DecimalString;
  costsCentavos: number;
}

// Pure (CLAUDE.md "validation at the edges"): a malformed price or costs string is rejected with
// no database round trip, the same fast fail `recordFillAction` always had.
export function parseFillAmounts({ price, costs }: RawFillAmounts): FillAmounts | null {
  const parsedPrice = parsePriceInput(price);
  const parsedCosts = costs.trim() === "" ? 0 : parseCentavosInput(costs);
  if (parsedPrice === null || parsedCosts === null) return null;
  return { price: parsedPrice, costsCentavos: parsedCosts };
}

export interface ResolveFillInstrumentInput extends FillAmounts {
  ticker: Ticker;
  side: FillSide;
  quantity: number;
}

export type ResolveFillInstrumentResult =
  { ok: true; fill: NewFill } | { ok: false; reason: "unknown_instrument" | "index_stock_leg" };

// The one place a raw ticker becomes a `NewFill` row (review round 2, #381): asset class is
// always read off the option-series lookup, never guessed from a caller's own `role`, so a stock
// leg gets the same "does this ticker even exist" check (`latestCandle`) an option leg's series
// lookup already gives it for free — `recordFillAction` and `recordFillsAsOperation` both call
// this, so the two can never drift the way a stock leg skipping that check once did.
export async function resolveFillInstrument(
  db: Database,
  session: SessionDate,
  input: ResolveFillInstrumentInput,
): Promise<ResolveFillInstrumentResult> {
  const series = (await optionSeriesForFills(db, [{ ticker: input.ticker, session }])).get(
    seriesKey(input.ticker, session),
  );
  if (!series && !(await latestCandle(db, input.ticker))) {
    return { ok: false, reason: "unknown_instrument" };
  }
  // A stock fill on a market index is never a real B3 fill (ADR-0062): B3's own investor-area
  // export cannot produce one.
  if (!series && isMarketIndex(input.ticker)) {
    return { ok: false, reason: "index_stock_leg" };
  }
  return {
    ok: true,
    fill: {
      ticker: input.ticker,
      assetClass: series ? "option" : "stock",
      side: input.side,
      quantity: input.quantity,
      price: input.price,
      session,
      costsCentavos: input.costsCentavos,
      expiry: series ? sessionDateSchema.parse(series.expiry) : null,
      source: "manual",
      importKey: null,
    },
  };
}

export interface RawFillInput extends RawFillAmounts {
  ticker: Ticker;
  side: FillSide;
  quantity: number;
}

export type ValidateFillInputResult =
  | { ok: true; fill: NewFill }
  | { ok: false; reason: "invalid_input" | "unknown_instrument" | "index_stock_leg" };

// `parseFillAmounts` and `resolveFillInstrument` combined, for a caller (`recordFillsAsOperation`)
// that takes a leg's raw, unparsed strings straight from the user and has no upfront,
// before-authentication fast path of its own to preserve.
export async function validateFillInput(
  db: Database,
  session: SessionDate,
  input: RawFillInput,
): Promise<ValidateFillInputResult> {
  const amounts = parseFillAmounts(input);
  if (!amounts) return { ok: false, reason: "invalid_input" };
  return resolveFillInstrument(db, session, { ...input, ...amounts });
}
