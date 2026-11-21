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
  isCredit: boolean;
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

// The farthest sampled point beyond `boundary` (strictly below it when `below` is true, else
// strictly above); null when the payoff grid never extends past `boundary` at all. A break-even
// that is itself the outermost sample reads as pnl 0 there, which is neither a profit nor a loss
// sign — reading the sign one step further out, rather than off that boundary sample, is what
// review finding #9 asked for (a break-even flush with the sampled edge must not read as "flat",
// which flipped `outside` into the unclassified fallback on rounding noise).
function farthestBeyond(
  payoff: readonly PayoffPoint[],
  boundary: Decimal,
  below: boolean,
): PayoffPoint | null {
  let farthest: PayoffPoint | null = null;
  for (const point of payoff) {
    const underlying = new Decimal(point.underlying);
    const isBeyond = below ? underlying.lt(boundary) : underlying.gt(boundary);
    if (!isBeyond) continue;
    if (!farthest) {
      farthest = point;
      continue;
    }
    const farther = below ? underlying.lt(farthest.underlying) : underlying.gt(farthest.underlying);
    if (farther) farthest = point;
  }
  return farthest;
}

function edgeSign(
  payoff: readonly PayoffPoint[],
  boundary: Decimal | null,
  below: boolean,
  fallback: PayoffPoint,
): -1 | 0 | 1 {
  const beyond = boundary ? farthestBeyond(payoff, boundary, below) : null;
  return sign((beyond ?? fallback).pnl);
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
  const isCredit = netPremium > 0;

  if (payoff.length < 2) {
    return { zone: { kind: "unclassified" }, isDebit, isCredit, netPremium, maxGain, maxLoss };
  }

  const sorted = [...breakEvens].sort((a, b) => new Decimal(a).comparedTo(new Decimal(b)));
  const first = payoff.at(0);
  const last = payoff.at(-1);

  let zone: ProfitZone = { kind: "unclassified" };
  if (first && last) {
    const lowestBoundary = sorted.length > 0 ? new Decimal(sorted[0] as DecimalString) : null;
    const highestBoundary =
      sorted.length > 0 ? new Decimal(sorted[sorted.length - 1] as DecimalString) : null;
    const leftSign = edgeSign(payoff, lowestBoundary, true, first);
    const rightSign = edgeSign(payoff, highestBoundary, false, last);
    const level = sorted.length === 1 ? sorted.at(0) : null;
    const lower = sorted.length === 2 ? sorted.at(0) : null;
    const upper = sorted.length === 2 ? sorted.at(1) : null;

    if (level && leftSign <= 0 && rightSign >= 0) {
      zone = { kind: "above", level };
    } else if (level && leftSign >= 0 && rightSign <= 0) {
      zone = { kind: "below", level };
    } else if (lower && upper) {
      const midpoint = new Decimal(lower).plus(upper).dividedBy(2);
      const midSign = sign(pnlNearest(payoff, midpoint) ?? centavosSchema.parse(0));
      if (midSign > 0 && leftSign <= 0 && rightSign <= 0) {
        zone = { kind: "between", lower, upper };
      } else if (midSign <= 0 && leftSign >= 0 && rightSign >= 0) {
        zone = { kind: "outside", lower, upper };
      }
    }
  }

  return { zone, isDebit, isCredit, netPremium, maxGain, maxLoss };
}

// Review finding #6: a zero-premium structure is neither a debit nor a credit, so the card's
// chip row must render neither label rather than default to "Crédito" on a premium of R$ 0,00.
export function premiumChipKind(summary: PayoffSummary): "debit" | "credit" | null {
  if (summary.isDebit) return "debit";
  if (summary.isCredit) return "credit";
  return null;
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

// Review finding #1: a debit's loss is only ever "what you paid" when the structure's own
// maxLoss equals the premium (every standard vertical, butterfly or condor it was written for).
// A broken-wing shape (admissible: strikes must be listed and strictly ordered, nothing else)
// can lose more than its debit on its wider wing, so the clause has to name that larger number
// instead of quietly repeating the premium.
function debitLossClause(
  netPremium: Centavos,
  maxLoss: Centavos | "unbounded",
  pay: string,
): string {
  if (maxLoss === "unbounded") return t.suggestions.sentence.unboundedLoss;
  return maxLoss === magnitude(netPremium)
    ? t.suggestions.sentence.lossClauseEqual(pay)
    : t.suggestions.sentence.lossUpTo(formatBRL(maxLoss));
}

function creditLossPhrase(maxLoss: Centavos | "unbounded"): string {
  return maxLoss === "unbounded"
    ? t.suggestions.sentence.unboundedLoss
    : t.suggestions.sentence.lossUpTo(formatBRL(maxLoss));
}

function gainClause(maxGain: Centavos | "unbounded"): string {
  return maxGain === "unbounded"
    ? t.suggestions.sentence.unboundedGain
    : t.suggestions.sentence.gainUpTo(formatBRL(maxGain));
}

function fallbackGainPhrase(maxGain: Centavos | "unbounded"): string {
  return maxGain === "unbounded"
    ? t.suggestions.sentence.fallbackUnboundedGain
    : t.suggestions.sentence.fallbackGainUpTo(formatBRL(maxGain));
}

// `useModal` is the credit/neutral family's "pode perder" phrasing; a plain debit says "perde".
function fallbackLossPhrase(maxLoss: Centavos | "unbounded", useModal: boolean): string {
  if (maxLoss === "unbounded") {
    return useModal
      ? t.suggestions.sentence.fallbackUnboundedLossCredit
      : t.suggestions.sentence.fallbackUnboundedLoss;
  }
  return useModal
    ? t.suggestions.sentence.fallbackLossUpToCredit(formatBRL(maxLoss))
    : t.suggestions.sentence.fallbackLossUpTo(formatBRL(maxLoss));
}

// Renders `summarizePayoff`'s classification as the one line the card opens with: what the
// viewer pays, receives or sets up at no cost, when they profit, and what the other side of the
// curve costs them. This function only chooses a sentence shape and formats its numbers; none of
// them are invented here, every one comes straight from the engine's own pricing.
export function payoffSummarySentence(
  summary: PayoffSummary,
  context: { ticker: string; date: string; hasStockLeg?: boolean },
): string {
  const { zone, isDebit, isCredit, netPremium, maxGain, maxLoss } = summary;
  const { ticker, date, hasStockLeg = false } = context;
  const pay = formatBRL(magnitude(netPremium));
  const receive = formatBRL(netPremium);
  const opening = isCredit
    ? t.suggestions.sentence.openingCredit(receive)
    : t.suggestions.sentence.openingNeutral;

  switch (zone.kind) {
    case "between": {
      const lower = formatPriceBRL(zone.lower);
      const upper = formatPriceBRL(zone.upper);
      if (isDebit) {
        return t.suggestions.sentence.between(
          pay,
          gainClause(maxGain),
          ticker,
          lower,
          upper,
          date,
          debitLossClause(netPremium, maxLoss, pay),
        );
      }
      return t.suggestions.sentence.betweenGain(
        opening,
        ticker,
        lower,
        upper,
        date,
        gainClause(maxGain),
        creditLossPhrase(maxLoss),
      );
    }
    case "outside": {
      const lower = formatPriceBRL(zone.lower);
      const upper = formatPriceBRL(zone.upper);
      if (isDebit) {
        return t.suggestions.sentence.outside(
          pay,
          ticker,
          lower,
          upper,
          date,
          debitLossClause(netPremium, maxLoss, pay),
        );
      }
      return t.suggestions.sentence.outsideGain(
        opening,
        ticker,
        lower,
        upper,
        date,
        gainClause(maxGain),
        creditLossPhrase(maxLoss),
      );
    }
    case "above": {
      const level = formatPriceBRL(zone.level);
      if (hasStockLeg && isDebit) {
        return t.suggestions.sentence.coveredCall(pay, ticker, level, date, boundedAmount(maxGain));
      }
      if (isDebit) {
        return t.suggestions.sentence.above(
          pay,
          ticker,
          level,
          date,
          gainClause(maxGain),
          debitLossClause(netPremium, maxLoss, pay),
        );
      }
      return t.suggestions.sentence.aboveGain(
        opening,
        ticker,
        level,
        date,
        gainClause(maxGain),
        creditLossPhrase(maxLoss),
      );
    }
    case "below": {
      const level = formatPriceBRL(zone.level);
      if (isDebit) {
        return t.suggestions.sentence.below(
          pay,
          ticker,
          level,
          date,
          gainClause(maxGain),
          debitLossClause(netPremium, maxLoss, pay),
        );
      }
      return t.suggestions.sentence.belowGain(
        opening,
        ticker,
        level,
        date,
        gainClause(maxGain),
        creditLossPhrase(maxLoss),
      );
    }
    case "unclassified":
      if (isDebit) {
        return t.suggestions.sentence.fallbackDebit(
          pay,
          fallbackGainPhrase(maxGain),
          fallbackLossPhrase(maxLoss, false),
        );
      }
      if (isCredit) {
        return t.suggestions.sentence.fallbackCredit(
          receive,
          fallbackGainPhrase(maxGain),
          fallbackLossPhrase(maxLoss, true),
        );
      }
      return t.suggestions.sentence.fallbackNeutral(
        fallbackGainPhrase(maxGain),
        fallbackLossPhrase(maxLoss, true),
      );
  }
}
