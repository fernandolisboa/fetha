import { centavosSchema } from "@fetha/contracts";

import { formatBRL, formatPriceBRL } from "@/lib/format/brl";

import type { IllustrativeExampleId, IllustrativeExamples } from "./illustrative-market";

const PLACEHOLDER_PATTERN = /\{\{([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9]+)?)\}\}/g;

const EXAMPLE_IDS: readonly IllustrativeExampleId[] = [
  "long-call",
  "long-put",
  "short-call",
  "bull-call-spread",
];

function isExampleId(value: string): value is IllustrativeExampleId {
  return (EXAMPLE_IDS as readonly string[]).includes(value);
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
