import Decimal from "decimal.js";
import type { DecimalString, SessionDate } from "@fetha/contracts";
import type { Greeks, Leg, LegValuation, Note, PriceSource } from "../api";
import { bsmGreeksRaw, bsmPriceRaw, type OptionRightRaw } from "./black-scholes";
import { SESSIONS_PER_YEAR } from "./calendar";
import { PRICE_SCALE, RATIO_SCALE, toDecimalString } from "./decimal";
import { solveImpliedVolatilityRaw } from "./implied-volatility";
import { STALE_PRICE_NOTE } from "./notes";

export type ResolvedMarketPrice = {
  value: DecimalString;
  source: PriceSource;
  stale: { session: SessionDate } | null;
};

export type PriceOptionLegInput = {
  leg: Leg & { role: "call" | "put" };
  strike: DecimalString;
  spot: DecimalString;
  riskFreeRate: DecimalString;
  dividendYield: DecimalString;
  timeToExpiryYears: number;
  marketPrice: ResolvedMarketPrice | null;
  givenVolatility: DecimalString | null;
  // A stale market price whose own session precedes a corporate-action ex-date visible on the
  // underlying sits on a different price scale than the current spot: solving implied
  // volatility from it against today's spot would read a phantom vol from the split itself,
  // not a real market view. The caller (`valueOneLeg`) is the one that knows
  // the underlying's own corporate-actions timeline, so it decides when to suppress this.
  suppressStaleImpliedVolatility?: boolean;
  // ADR-0063: the series' own `priceFactor` (absent = 1). `spot`/`strike` stay in the series'
  // quotation unit (index points for an index option); `marketPrice` is a premium already in
  // reais per contract, so it is scaled up to that same unit before the model ever sees it, and
  // every model output (fairValue, the money-valued greeks) is scaled back down before it
  // leaves this function. Delta is unit-free and crosses this seam unchanged.
  priceFactor?: DecimalString | undefined;
};

const VOLATILITY_POINT = 0.01;

// ADR-0013 "Rates, time and greeks": theta is reported per session (annual theta / 252),
// vega per one volatility point (0.01), rho per 1.00 of rate (no rescaling: the raw
// derivative is already "per unit of r").
function toReportedGreeks(raw: ReturnType<typeof bsmGreeksRaw>, priceFactor: number): Greeks {
  return {
    delta: toDecimalString(new Decimal(raw.delta), RATIO_SCALE),
    gamma: toDecimalString(new Decimal(raw.gamma).div(priceFactor), RATIO_SCALE),
    theta: toDecimalString(
      new Decimal(raw.theta / SESSIONS_PER_YEAR).div(priceFactor),
      RATIO_SCALE,
    ),
    vega: toDecimalString(new Decimal(raw.vega * VOLATILITY_POINT).div(priceFactor), RATIO_SCALE),
    rho: toDecimalString(new Decimal(raw.rho).div(priceFactor), RATIO_SCALE),
  };
}

export function priceOptionLeg(input: PriceOptionLegInput): LegValuation {
  const notes: Note[] = [];
  const right: OptionRightRaw = input.leg.role;
  const s = Number(input.spot);
  const k = Number(input.strike);
  const r = Number(input.riskFreeRate);
  const q = Number(input.dividendYield);
  const t = Math.max(input.timeToExpiryYears, 0);
  // ADR-0063: `priceFactor` is assumed already validated positive by the caller (the same
  // trust `s`/`k` above already carry) — the one place both this leg's spot/strike and its
  // series' own factor are resolved together.
  const priceFactor = input.priceFactor ? Number(input.priceFactor) : 1;

  let volatilitySource: LegValuation["volatilitySource"] = null;
  let sigma: number | null = null;
  let impliedVolatility: DecimalString | null = null;

  if (input.givenVolatility) {
    volatilitySource = "given";
    sigma = Number(input.givenVolatility);
  }

  let suppressIv = false;
  if (input.marketPrice) {
    // The market price is a premium already in reais per contract (ADR-0063); `s`/`k` stay in
    // the series' own quotation unit, so the price is scaled up to that same unit before the
    // model ever compares it to them.
    const price = Number(input.marketPrice.value) * priceFactor;
    suppressIv = Boolean(input.marketPrice.stale) && Boolean(input.suppressStaleImpliedVolatility);
    if (suppressIv) {
      notes.push({
        code: "stale_price_across_corporate_action",
        message:
          "the last traded price predates a corporate-action ex-date on the underlying; implied volatility is not solved from it",
      });
    } else {
      const solved = solveImpliedVolatilityRaw({ s, k, t, r, q, right, price });
      if (solved.ok) {
        impliedVolatility = toDecimalString(new Decimal(solved.sigma), RATIO_SCALE);
        if (!input.givenVolatility) {
          sigma = solved.sigma;
          volatilitySource = input.marketPrice.stale ? "last_trade_implied" : "own_implied";
        }
      } else {
        notes.push({
          code: "iv_not_converged",
          message: "implied volatility did not converge from the visible market price",
        });
        const intrinsicFloor = right === "call" ? Math.max(s - k, 0) : Math.max(k - s, 0);
        if (price < intrinsicFloor) {
          notes.push({
            code: "below_intrinsic",
            message: "market price is below the model's intrinsic value floor",
          });
        }
      }
    }
    if (input.marketPrice.source === "average" && !suppressIv) {
      notes.push({
        code: "iv_from_average_price",
        message: "implied volatility solved from the session average price",
      });
    }
    if (input.marketPrice.stale) {
      notes.push(STALE_PRICE_NOTE);
    }
  } else {
    notes.push({ code: "no_market_price", message: "no market price visible for this leg" });
  }

  let fairValue: DecimalString | null = null;
  let greeks: Greeks | null = null;
  if (sigma !== null && sigma > 0 && s > 0 && k > 0) {
    const priceRaw = bsmPriceRaw({ s, k, t, r, q, sigma, right });
    const greeksRaw = bsmGreeksRaw({ s, k, t, r, q, sigma, right });
    // Last-line guard at the number-to-Decimal seam (ADR-0002): callers are expected to
    // reject a non-positive spot/strike before pricing, so this should be unreachable in
    // practice, but toDecimalString throws on a non-finite input and this seam has no
    // other way to report that back than to leave the leg unpriced.
    if (Number.isFinite(priceRaw) && Object.values(greeksRaw).every(Number.isFinite)) {
      // The model priced on the series' own quotation unit (points, for an index option);
      // scaled back down to reais per contract (ADR-0063) before it becomes a fair value.
      fairValue = toDecimalString(new Decimal(priceRaw).div(priceFactor), PRICE_SCALE);
      greeks = toReportedGreeks(greeksRaw, priceFactor);
      notes.push({
        code: "european_pricing",
        message: "priced as a European option under Black-Scholes-Merton (ADR-0002)",
      });
    }
  }

  return {
    leg: {
      role: input.leg.role,
      side: input.leg.side,
      ticker: input.leg.ticker,
      quantity: input.leg.quantity,
    },
    price: input.marketPrice?.value ?? null,
    priceSource: input.marketPrice?.source ?? null,
    stale: input.marketPrice?.stale ?? null,
    fairValue,
    impliedVolatility,
    volatilitySource,
    greeks,
    timeToExpiryYears: toDecimalString(new Decimal(t), RATIO_SCALE),
    notes,
  };
}
