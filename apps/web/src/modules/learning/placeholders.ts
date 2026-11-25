import { Decimal } from "decimal.js";
import {
  centavosSchema,
  decimalStringSchema,
  illustrativeExampleIdSchema,
  type IllustrativeExampleId,
} from "@fetha/contracts";

import { formatBRL, formatPriceBRL } from "@/lib/format/brl";
import { formatDecimal } from "@/lib/format/decimal";
import { formatPercent } from "@/lib/format/percent";
import { formatQuantity } from "@/lib/format/quantity";
import { DEFAULT_RISK_PROFILE } from "@/modules/portfolio/client";

import type { IllustrativeExamples } from "./illustrative-market";
import { seriesLetterOf } from "./series-code";

// The default risk profile's own declared capital and max-loss-per-operation limit
// (`modules/portfolio`'s `DEFAULT_RISK_PROFILE`, ADR-0075) — an input a user declares, not an
// engine output, but still never hand-typed into a lesson: the cap below is computed from it in
// code, the same rule CLAUDE.md's "no hand-written numbers" applies to everything else here.
function defaultMaxLossCapCentavos(): number {
  return new Decimal(DEFAULT_RISK_PROFILE.declaredCapital)
    .mul(DEFAULT_RISK_PROFILE.limits.maxLossPerOperation)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();
}

const PLACEHOLDER_PATTERN = /\{\{([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9]+)?)\}\}/g;

function isExampleId(value: string): value is IllustrativeExampleId {
  return illustrativeExampleIdSchema.safeParse(value).success;
}

// Every placeholder a lesson may use, resolved only from engine output over
// the fixed illustrative market (CLAUDE.md principle 1: no hand-written
// price, break-even or max gain/loss). Unknown or unresolvable tokens throw,
// so a typo or an example priced "unbounded" where a lesson expects a number
// fails the content check instead of shipping a broken placeholder.
export function resolvePlaceholder(token: string, examples: IllustrativeExamples): string {
  if (token === "spot") return formatPriceBRL(examples.spot);
  if (token === "lowestStrike") return formatPriceBRL(examples.lowestStrike);
  if (token === "lowerStrike") return formatPriceBRL(examples.lowerStrike);
  if (token === "lowerMidStrike") return formatPriceBRL(examples.lowerMidStrike);
  if (token === "upperMidStrike") return formatPriceBRL(examples.upperMidStrike);
  if (token === "higherStrike") return formatPriceBRL(examples.higherStrike);
  if (token === "underlying") return examples.underlying;
  if (token === "defaultDeclaredCapitalAbs") {
    return formatBRL(centavosSchema.parse(DEFAULT_RISK_PROFILE.declaredCapital));
  }
  if (token === "defaultMaxLossPerOperationPercent") {
    return formatPercent(DEFAULT_RISK_PROFILE.limits.maxLossPerOperation);
  }
  if (token === "defaultMaxLossCapAbs") {
    return formatBRL(centavosSchema.parse(defaultMaxLossCapCentavos()));
  }

  const [exampleId, field] = token.split(".");
  if (exampleId === undefined || field === undefined || !isExampleId(exampleId)) {
    throw new Error(`unknown placeholder token "${token}"`);
  }
  const pricing = examples[exampleId];

  if (field === "premiumAbs") {
    return formatBRL(centavosSchema.parse(Math.abs(pricing.netPremium)));
  }
  if (field === "maxLossAbs") {
    if (pricing.maxLoss === "unbounded") {
      throw new Error(`placeholder "${token}" resolves to an unbounded max loss`);
    }
    return formatBRL(centavosSchema.parse(Math.abs(pricing.maxLoss)));
  }
  if (field === "maxGainAbs") {
    if (pricing.maxGain === "unbounded") {
      throw new Error(`placeholder "${token}" resolves to an unbounded max gain`);
    }
    return formatBRL(centavosSchema.parse(Math.abs(pricing.maxGain)));
  }
  if (field === "maxLossPerLotAbs" || field === "maxLossLotsAtDefaultCap") {
    if (pricing.maxLoss === "unbounded") {
      throw new Error(`placeholder "${token}" resolves to an unbounded max loss`);
    }
    // A lot is 100 options (CLAUDE.md money rule), so a lot's own worst case is the per-share
    // max loss ×100 — the same per-lot convention `thetaAbs` already uses.
    const perLotCentavos = Math.abs(pricing.maxLoss) * 100;
    if (field === "maxLossPerLotAbs") {
      return formatBRL(centavosSchema.parse(perLotCentavos));
    }
    const lots = Math.floor(defaultMaxLossCapCentavos() / perLotCentavos);
    return formatQuantity(lots);
  }
  const breakEvenMatch = /^breakEven(\d+)$/.exec(field);
  if (breakEvenMatch) {
    const index = Number(breakEvenMatch[1]);
    const breakEven = pricing.breakEvens[index];
    if (breakEven === undefined) {
      throw new Error(`placeholder "${token}" has no break-even to resolve`);
    }
    return formatPriceBRL(breakEven);
  }
  if (field === "delta" || field === "gamma") {
    // Delta and gamma are shown as a bare ratio to four decimals, aggregated as integers per
    // operation (DESIGN.md "Greeks"), unlike theta and vega, which DESIGN.md states as money.
    return formatDecimal(pricing.greeks[field], 4);
  }
  if (field === "vega") {
    // Vega is money: the fair-value change per volatility point, per share (DESIGN.md "Greeks":
    // "vega in R$ / ponto"), the same quantity `GreeksPanel` shows with formatPriceBRL. A lesson's
    // own prose states the "/ ponto" unit and the ×100-per-lot conversion, never baked in here.
    return formatPriceBRL(pricing.greeks.vega);
  }
  if (field === "thetaAbs") {
    // Theta is per share; a B3 lot is 100 options, one per share (CLAUDE.md money rule: never
    // show a per-share greek as if it were the position's own size), so this is the per-lot
    // magnitude — also keeps it from rounding away to R$0,00 for a cheap, far-dated option.
    const perLot = new Decimal(pricing.greeks.theta).abs().mul(100).toFixed(6);
    return formatPriceBRL(decimalStringSchema.parse(perLot));
  }
  if (field === "ticker" || field === "tickerLetter") {
    if (pricing.legs.length !== 1) {
      throw new Error(`placeholder "${token}" needs a single-leg example to name one ticker`);
    }
    const ticker = pricing.legs[0]?.leg.ticker ?? "";
    return field === "ticker" ? ticker : seriesLetterOf(ticker);
  }

  throw new Error(`unknown placeholder token "${token}"`);
}

export function placeholderTokens(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1] ?? "");
}

export function resolveText(text: string, examples: IllustrativeExamples): string {
  return text.replace(PLACEHOLDER_PATTERN, (_match, token: string) =>
    resolvePlaceholder(token, examples),
  );
}
