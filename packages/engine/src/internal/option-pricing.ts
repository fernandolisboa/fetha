import Decimal from "decimal.js";
import type { DecimalString, SessionDate } from "@fetha/contracts";
import type { Greeks, Leg, LegValuation, Note, PriceSource } from "../api";
import { bsmGreeksRaw, bsmPriceRaw, type OptionRightRaw } from "./black-scholes";
import { PRICE_SCALE, RATIO_SCALE, toDecimalString } from "./decimal";
import { solveImpliedVolatilityRaw } from "./implied-volatility";

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
};

const SESSIONS_PER_YEAR = 252;
const VOLATILITY_POINT = 0.01;

// ADR-0013 "Rates, time and greeks": theta is reported per session (annual theta / 252),
// vega per one volatility point (0.01), rho per 1.00 of rate (no rescaling: the raw
// derivative is already "per unit of r").
function toReportedGreeks(raw: ReturnType<typeof bsmGreeksRaw>): Greeks {
  return {
    delta: toDecimalString(new Decimal(raw.delta), RATIO_SCALE),
    gamma: toDecimalString(new Decimal(raw.gamma), RATIO_SCALE),
    theta: toDecimalString(new Decimal(raw.theta / SESSIONS_PER_YEAR), RATIO_SCALE),
    vega: toDecimalString(new Decimal(raw.vega * VOLATILITY_POINT), RATIO_SCALE),
    rho: toDecimalString(new Decimal(raw.rho), RATIO_SCALE),
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

  let volatilitySource: LegValuation["volatilitySource"] = null;
  let sigma: number | null = null;
  let impliedVolatility: DecimalString | null = null;

  if (input.givenVolatility) {
    volatilitySource = "given";
    sigma = Number(input.givenVolatility);
  }

  if (input.marketPrice) {
    const price = Number(input.marketPrice.value);
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
    if (input.marketPrice.source === "average") {
      notes.push({
        code: "iv_from_average_price",
        message: "implied volatility solved from the session average price",
      });
    }
  } else {
    notes.push({ code: "no_market_price", message: "no market price visible for this leg" });
  }

  let fairValue: DecimalString | null = null;
  let greeks: Greeks | null = null;
  if (sigma !== null && sigma > 0) {
    const priceRaw = bsmPriceRaw({ s, k, t, r, q, sigma, right });
    fairValue = toDecimalString(new Decimal(priceRaw), PRICE_SCALE);
    greeks = toReportedGreeks(bsmGreeksRaw({ s, k, t, r, q, sigma, right }));
    notes.push({
      code: "european_pricing",
      message: "priced as a European option under Black-Scholes-Merton (ADR-0002)",
    });
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
