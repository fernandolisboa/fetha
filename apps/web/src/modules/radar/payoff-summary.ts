import { Decimal } from "decimal.js";
import { centavosSchema, type Centavos, type DecimalString } from "@fetha/contracts";
import type { PayoffPoint } from "@fetha/engine";

import { formatBRL, formatPriceBRL } from "@/lib/format/brl";

import { t } from "./strings";

export type ProfitZone =
  | { kind: "between"; lower: DecimalString; upper: DecimalString }
  | { kind: "outside"; lower: DecimalString; upper: DecimalString }
  | { kind: "above"; level: DecimalString }
  | { kind: "below"; level: DecimalString }
  | { kind: "unclassified" };

export interface PayoffSummary {
  zone: ProfitZone;
  isDebit: boolean;
  netPremium: Centavos;
  maxGain: Centavos | "unbounded";
  maxLoss: Centavos | "unbounded";
}

function sign(pnl: Centavos): -1 | 0 | 1 {
  return pnl > 0 ? 1 : pnl < 0 ? -1 : 0;
}

// Null only for an empty payoff; `summarizePayoff` never calls this on one.
function pnlNearest(payoff: readonly PayoffPoint[], target: Decimal): Centavos | null {
  let closest: PayoffPoint | null = null;
  let closestDistance: Decimal | null = null;
  for (const point of payoff) {
    const distance = Decimal.abs(new Decimal(point.underlying).minus(target));
    if (!closestDistance || distance.lt(closestDistance)) {
      closest = point;
      closestDistance = distance;
    }
  }
  return closest?.pnl ?? null;
}

// Reads the shape of the profit zone off the curve itself (ticket: "detect it from where the
// curve is above zero, not from the recipe id"), anchored at the engine's own break-evens: with
// one, which side of it is the profit side; with two, whether the profit sits between them or
// outside them. Any other count of break-evens, or a curve whose signs do not agree with that
// count, is a shape this sentence cannot name, so it falls back rather than guess.
export function summarizePayoff(input: {
  payoff: readonly PayoffPoint[];
  breakEvens: readonly DecimalString[];
  netPremium: Centavos;
  maxGain: Centavos | "unbounded";
  maxLoss: Centavos | "unbounded";
}): PayoffSummary {
  const { payoff, breakEvens, netPremium, maxGain, maxLoss } = input;
  const isDebit = netPremium < 0;

  if (payoff.length < 2) {
    return { zone: { kind: "unclassified" }, isDebit, netPremium, maxGain, maxLoss };
  }

  const sorted = [...breakEvens].sort((a, b) => new Decimal(a).comparedTo(new Decimal(b)));
  const first = payoff.at(0);
  const last = payoff.at(-1);

  let zone: ProfitZone = { kind: "unclassified" };
  if (first && last) {
    const leftSign = sign(first.pnl);
    const rightSign = sign(last.pnl);
    const level = sorted.length === 1 ? sorted.at(0) : null;
    const lower = sorted.length === 2 ? sorted.at(0) : null;
    const upper = sorted.length === 2 ? sorted.at(1) : null;

    if (level && leftSign <= 0 && rightSign > 0) {
      zone = { kind: "above", level };
    } else if (level && leftSign > 0 && rightSign <= 0) {
      zone = { kind: "below", level };
    } else if (lower && upper) {
      const midpoint = new Decimal(lower).plus(upper).dividedBy(2);
      const midSign = sign(pnlNearest(payoff, midpoint) ?? centavosSchema.parse(0));
      if (midSign > 0 && leftSign <= 0 && rightSign <= 0) {
        zone = { kind: "between", lower, upper };
      } else if (midSign <= 0 && leftSign > 0 && rightSign > 0) {
        zone = { kind: "outside", lower, upper };
      }
    }
  }

  return { zone, isDebit, netPremium, maxGain, maxLoss };
}

export function gainToRiskRatio(
  maxGain: Centavos | "unbounded",
  maxLoss: Centavos | "unbounded",
): string {
  if (maxGain === "unbounded" || maxLoss === "unbounded" || maxLoss <= 0) return "—";
  const ratio = new Decimal(maxGain).dividedBy(maxLoss).toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  return `${ratio.toFixed(1).replace(".", ",")}×`;
}

function magnitude(value: Centavos): Centavos {
  return centavosSchema.parse(Math.abs(value));
}

// A bounded shape's gain or loss is always a `Centavos` by construction; "unbounded" only shows
// up here on a shape this module did not expect it from, so it falls back to a dash rather than
// misreport a number.
function boundedAmount(value: Centavos | "unbounded"): string {
  return value === "unbounded" ? "—" : formatBRL(value);
}

function creditLossPhrase(maxLoss: Centavos | "unbounded"): string {
  return maxLoss === "unbounded"
    ? t.suggestions.sentence.unboundedLoss
    : t.suggestions.sentence.lossUpTo(formatBRL(maxLoss));
}

function debitGainPhrase(maxGain: Centavos | "unbounded"): string {
  return maxGain === "unbounded"
    ? t.suggestions.sentence.unboundedGain
    : t.suggestions.sentence.gainUpTo(formatBRL(maxGain));
}

function fallbackGainPhrase(maxGain: Centavos | "unbounded"): string {
  return maxGain === "unbounded"
    ? t.suggestions.sentence.fallbackUnboundedGain
    : t.suggestions.sentence.fallbackGainUpTo(formatBRL(maxGain));
}

function fallbackLossPhrase(maxLoss: Centavos | "unbounded", isDebit: boolean): string {
  if (maxLoss === "unbounded") {
    return isDebit
      ? t.suggestions.sentence.fallbackUnboundedLoss
      : t.suggestions.sentence.fallbackUnboundedLossCredit;
  }
  return isDebit
    ? t.suggestions.sentence.fallbackLossUpTo(formatBRL(maxLoss))
    : t.suggestions.sentence.fallbackLossUpToCredit(formatBRL(maxLoss));
}

// Renders `summarizePayoff`'s classification as the one line the card opens with: what the
// viewer pays or receives, when they profit, and what the other side of the curve costs them.
// This function only chooses a sentence shape and formats its numbers; none of them are
// invented here, every one comes straight from the engine's own pricing.
export function payoffSummarySentence(
  summary: PayoffSummary,
  context: { ticker: string; date: string; hasStockLeg?: boolean },
): string {
  const { zone, isDebit, netPremium, maxGain, maxLoss } = summary;
  const { ticker, date, hasStockLeg = false } = context;
  const pay = formatBRL(magnitude(netPremium));
  const receive = formatBRL(netPremium);

  switch (zone.kind) {
    case "between": {
      const lower = formatPriceBRL(zone.lower);
      const upper = formatPriceBRL(zone.upper);
      return isDebit
        ? t.suggestions.sentence.between(pay, boundedAmount(maxGain), ticker, lower, upper, date)
        : t.suggestions.sentence.betweenCredit(
            receive,
            ticker,
            lower,
            upper,
            date,
            creditLossPhrase(maxLoss),
          );
    }
    case "outside": {
      const lower = formatPriceBRL(zone.lower);
      const upper = formatPriceBRL(zone.upper);
      return isDebit
        ? t.suggestions.sentence.outside(pay, ticker, lower, upper, date)
        : t.suggestions.sentence.outsideCredit(
            receive,
            ticker,
            lower,
            upper,
            date,
            creditLossPhrase(maxLoss),
          );
    }
    case "above": {
      const level = formatPriceBRL(zone.level);
      if (hasStockLeg && isDebit) {
        return t.suggestions.sentence.coveredCall(pay, ticker, level, date, boundedAmount(maxGain));
      }
      return isDebit
        ? t.suggestions.sentence.above(pay, ticker, level, date, debitGainPhrase(maxGain))
        : t.suggestions.sentence.aboveCredit(
            receive,
            ticker,
            level,
            date,
            creditLossPhrase(maxLoss),
          );
    }
    case "below": {
      const level = formatPriceBRL(zone.level);
      return isDebit
        ? t.suggestions.sentence.below(pay, ticker, level, date, debitGainPhrase(maxGain))
        : t.suggestions.sentence.belowCredit(
            receive,
            ticker,
            level,
            date,
            creditLossPhrase(maxLoss),
          );
    }
    case "unclassified":
      return isDebit
        ? t.suggestions.sentence.fallbackDebit(
            pay,
            fallbackGainPhrase(maxGain),
            fallbackLossPhrase(maxLoss, true),
          )
        : t.suggestions.sentence.fallbackCredit(
            receive,
            fallbackGainPhrase(maxGain),
            fallbackLossPhrase(maxLoss, false),
          );
  }
}
