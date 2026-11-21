import {
  centavosSchema,
  illustrativeExampleIdSchema,
  type IllustrativeExampleId,
} from "@fetha/contracts";

import { formatBRL, formatPriceBRL } from "@/lib/format/brl";

import type { IllustrativeExamples } from "./illustrative-market";
import { seriesLetterOf } from "./series-code";

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
  if (token === "lowerStrike") return formatPriceBRL(examples.lowerStrike);
  if (token === "higherStrike") return formatPriceBRL(examples.higherStrike);
  if (token === "underlying") return examples.underlying;

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
  if (field === "breakEven0") {
    const breakEven = pricing.breakEvens[0];
    if (breakEven === undefined) {
      throw new Error(`placeholder "${token}" has no break-even to resolve`);
    }
    return formatPriceBRL(breakEven);
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
