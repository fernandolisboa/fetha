import Decimal from "decimal.js";
import type { Centavos, CostModel, DecimalString } from "@fetha/contracts";
import type { Candle, Leg, MarketView, OptionDayPrice, Side, TradingSession } from "../api";
import { CENTAVOS_PER_REAL, PRICE_SCALE, parseDecimal, toDecimalString } from "./decimal";
import { isAtOrBefore } from "./instant";
import { toCentavos } from "./scalars";

// Shared by runBacktest (its own session-indexed fill loop) and score's counterfactual
// entry/exit search (ADR-0014 Q40): the gross traded value of a fill or a mark, on the
// centavos scale but not yet rounded to an integer Centavos.
export function grossCentavos(price: DecimalString, quantity: number | Decimal): Decimal {
  return parseDecimal(price).mul(CENTAVOS_PER_REAL).mul(quantity);
}

export function fillCosts(
  costModel: CostModel,
  price: DecimalString,
  quantity: number,
  kind: "stock" | "option" = "stock",
): Centavos {
  const gross = grossCentavos(price, quantity);
  const b3Fee = gross.mul(parseDecimal(costModel.b3FeeRate)).round().toNumber();
  const brokerage =
    kind === "option" ? costModel.brokerage.optionPerContract : costModel.brokerage.stockPerOrder;
  return toCentavos(b3Fee + brokerage);
}

// ADR-0013 "Fills": `Fill.price` includes slippage — the option reference price times
// `(1 + optionSlippageRate)` for a buy and `(1 - optionSlippageRate)` for a sell, at scale 2.
// A stock leg is never slipped (fills at the raw session open).
export function slippedOptionPrice(
  reference: DecimalString,
  side: Side,
  rate: DecimalString,
): DecimalString {
  const factor =
    side === "buy"
      ? new Decimal(1).add(parseDecimal(rate))
      : new Decimal(1).sub(parseDecimal(rate));
  return toDecimalString(parseDecimal(reference).mul(factor), PRICE_SCALE);
}

// The slippage metric (ADR-0013 "Equity and metrics"): the sum over option fills of
// `|price - reference| * quantity`, informational only since it is already inside `Fill.price`.
export function slippageCentavos(
  reference: DecimalString,
  filled: DecimalString,
  quantity: number,
): Centavos {
  return toCentavos(
    parseDecimal(filled)
      .sub(reference)
      .abs()
      .mul(CENTAVOS_PER_REAL)
      .mul(quantity)
      .round()
      .toNumber(),
  );
}

export type FillOpportunity =
  | {
      ready: true;
      price: DecimalString;
      reference: DecimalString;
      source: "next_session_open" | "next_session_average";
      kind: "stock" | "option";
    }
  | { ready: false };

// A leg's fill readiness and price at a given session, on the daily fill model ADR-0013
// "Fills" fixes: a stock leg at that session's own open, an option leg at that session's
// average traded price plus slippage. `tradeSide` is the side of this trade itself (a leg's
// own `side` on entry, the opposite on exit), since slippage direction depends on which way
// this particular trade goes, not on the leg's resting side. Callers that already hold a
// map keyed by ticker (runBacktest, scanning many sessions) may prefer their own indexed
// lookup; this scans `view` directly, for callers (score's counterfactual) that check one
// session at a time.
export function resolveFillOpportunity(
  view: MarketView,
  costModel: CostModel,
  leg: Leg,
  session: TradingSession,
  tradeSide: Side,
): FillOpportunity {
  if (leg.role === "stock") {
    const candle = view.candles.find(
      (c): c is Candle =>
        c.ticker === leg.ticker &&
        c.timeframe === "D1" &&
        c.session === session.date &&
        isAtOrBefore(c.asOf, session.close),
    );
    if (!candle || candle.tradedQuantity <= 0) return { ready: false };
    return {
      ready: true,
      price: candle.open,
      reference: candle.open,
      source: "next_session_open",
      kind: "stock",
    };
  }
  const dayPrice = view.optionPrices.find(
    (p): p is OptionDayPrice =>
      p.ticker === leg.ticker && p.session === session.date && isAtOrBefore(p.asOf, session.close),
  );
  if (!dayPrice || dayPrice.tradedQuantity <= 0 || !dayPrice.average) return { ready: false };
  const filled = slippedOptionPrice(dayPrice.average, tradeSide, costModel.optionSlippageRate);
  return {
    ready: true,
    price: filled,
    reference: dayPrice.average,
    source: "next_session_average",
    kind: "option",
  };
}
