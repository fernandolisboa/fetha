import { Decimal } from "decimal.js";
import type { Condition, ExitRule, Operand } from "@fetha/contracts";

import { formatDecimal } from "@/lib/format/decimal";
import { formatPercent } from "@/lib/format/percent";

import { t } from "./strings";

function operandText(operand: Operand): string {
  switch (operand.kind) {
    case "price":
      return t.rule.operand[operand.field];
    case "constant":
      return formatDecimal(operand.value, Math.min(new Decimal(operand.value).decimalPlaces(), 4));
    case "indicator":
      return operand.indicator.kind === "iv_rank"
        ? t.rule.operand.iv_rank(operand.indicator.lookbackSessions)
        : t.rule.operand[operand.indicator.kind](operand.indicator.length);
  }
}

export type RuleLine = { text: string; depth: number };

// An operand's own name, plus what it actually read today right next to it (review round 2,
// finding #2): a constant already prints its value as its name, so it is never observed.
function operandWithValue(
  operand: Operand,
  observe: ((operand: Operand) => string | null) | undefined,
): string {
  const text = operandText(operand);
  if (!observe || operand.kind === "constant") return text;
  const value = observe(operand);
  return value ? `${text} ${value}` : text;
}

// A recipe's entry condition as nested lines (docs/adr/0067's suggestion page): a top-level
// "and" reads as the list itself, anything nested names its connective. `observe`, when given,
// reads an operand against today's facts so each side of a comparison can show what matched it,
// without a second tree walk of its own.
export function conditionLines(
  condition: Condition,
  depth = 0,
  observe?: (operand: Operand) => string | null,
): RuleLine[] {
  switch (condition.kind) {
    case "compare": {
      const left = operandWithValue(condition.left, observe);
      const right = operandWithValue(condition.right, observe);
      return [{ text: `${left} ${t.rule.comparators[condition.comparator]} ${right}`, depth }];
    }
    case "and":
      return depth === 0
        ? condition.conditions.flatMap((child) => conditionLines(child, depth, observe))
        : [
            { text: t.rule.and, depth },
            ...condition.conditions.flatMap((child) => conditionLines(child, depth + 1, observe)),
          ];
    case "or":
      return [
        { text: t.rule.or, depth },
        ...condition.conditions.flatMap((child) => conditionLines(child, depth + 1, observe)),
      ];
    case "not":
      return [
        { text: t.rule.not, depth },
        ...conditionLines(condition.condition, depth + 1, observe),
      ];
  }
}

export function exitText(rule: ExitRule): string {
  switch (rule.kind) {
    case "profit_target":
      return t.rule.profitTarget(formatPercent(rule.fractionOfPremium));
    case "stop_loss":
      return t.rule.stopLoss(formatPercent(rule.multipleOfMaxLoss));
    case "days_before_expiry":
      return t.rule.daysBeforeExpiry(rule.businessDays);
    case "condition":
      return t.rule.exitCondition;
  }
}
