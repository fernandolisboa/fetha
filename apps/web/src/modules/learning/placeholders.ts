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
import { DEFAULT_RISK_PROFILE, riskLimitCentavos } from "@/modules/portfolio/client";

import type { IllustrativeExamples } from "./illustrative-market";
import { seriesLetterOf } from "./series-code";

// The default risk profile's own declared capital and max-loss-per-operation limit
// (`modules/portfolio`'s `DEFAULT_RISK_PROFILE`, ADR-0075) — an input a user declares, not an
// engine output, but still never hand-typed into a lesson. The cap is `portfolio`'s own
// `riskLimitCentavos`, the one place this ratio turns into an absolute amount; `plans`' sizing
// reads the same function, so a lesson and the sizing it describes can never disagree.
function defaultMaxLossCapCentavos(): number {
  return riskLimitCentavos(DEFAULT_RISK_PROFILE);
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
    if (perLotCentavos <= 0) {
      throw new Error(`placeholder "${token}" has no positive per-lot max loss to size against`);
    }
    if (field === "maxLossPerLotAbs") {
      return formatBRL(centavosSchema.parse(perLotCentavos));
    }
    const lots = Math.floor(defaultMaxLossCapCentavos() / perLotCentavos);
    if (lots < 1) {
      throw new Error(`placeholder "${token}" resolves to fewer than one lot at the default cap`);
    }
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
  if (field === "deltaShares" || field === "gammaShares") {
    // The suggestion card's own "shares equivalent" reading (`sharesText`,
    // radar/components/greek-notes.tsx), reproduced here rather than imported: `learning` has no
    // dependency on `radar` (ARCHITECTURE.md), and the function is a handful of lines. ×100 for
    // the lot (CLAUDE.md money rule), rounded to a whole share unless that would erase a nonzero
    // value, in which case one decimal survives instead.
    const perLotShares = new Decimal(pricing.greeks[field === "deltaShares" ? "delta" : "gamma"])
      .mul(100)
      .abs();
    let decimals = 0;
    let rounded = perLotShares.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
    if (rounded.isZero() && !perLotShares.isZero()) {
      decimals = 1;
      rounded = perLotShares.toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
    }
    return formatDecimal(decimalStringSchema.parse(rounded.toString()), decimals);
  }
  if (field === "vega") {
    // Vega is money: the fair-value change per volatility point (DESIGN.md "Greeks": "vega in
    // R$ / ponto"). The engine returns it per share; a B3 lot is 100 options, one per share
    // (CLAUDE.md money rule), so this is the per-lot magnitude, scaled in Decimal before
    // formatting the same way `thetaAbs` is — a per-share value rounded to the centavo first and
    // then ×100 would compound the rounding error well past a single cent. Sign kept, unlike
    // `thetaAbs`: a lesson's own prose says whether a lot is long or short volatility from this
    // sign directly, never instructing the reader to multiply.
    const perLot = new Decimal(pricing.greeks.vega).mul(100).toFixed(6);
    return formatPriceBRL(decimalStringSchema.parse(perLot));
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
