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

// A recipe's entry condition as nested lines (docs/adr/0067's suggestion page): a top-level
// "and" reads as the list itself, anything nested names its connective.
export function conditionLines(condition: Condition, depth = 0): RuleLine[] {
  switch (condition.kind) {
    case "compare":
      return [
        {
          text: `${operandText(condition.left)} ${t.rule.comparators[condition.comparator]} ${operandText(condition.right)}`,
          depth,
        },
      ];
    case "and":
      return depth === 0
        ? condition.conditions.flatMap((child) => conditionLines(child, depth))
        : [
            { text: t.rule.and, depth },
            ...condition.conditions.flatMap((child) => conditionLines(child, depth + 1)),
          ];
    case "or":
      return [
        { text: t.rule.or, depth },
        ...condition.conditions.flatMap((child) => conditionLines(child, depth + 1)),
      ];
    case "not":
      return [{ text: t.rule.not, depth }, ...conditionLines(condition.condition, depth + 1)];
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
