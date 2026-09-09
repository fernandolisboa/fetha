import Decimal from "decimal.js";
import type { Condition, Operand } from "@fetha/contracts";
import type { Candle } from "../api";
import { indicatorSpecKey } from "./collect-indicator-specs";
import { parseDecimal } from "./decimal";

export { indicatorSpecKey };

export type Verdict = "true" | "false" | "unknown";

export type ConditionContext = {
  candle: Candle;
  indicatorValues: ReadonlyMap<string, Decimal | null>;
};

function resolveOperand(operand: Operand, ctx: ConditionContext): Decimal | null {
  switch (operand.kind) {
    case "constant":
      return parseDecimal(operand.value);
    case "price":
      return operand.field === "tradedQuantity"
        ? new Decimal(ctx.candle.tradedQuantity)
        : parseDecimal(ctx.candle[operand.field]);
    case "indicator":
      return ctx.indicatorValues.get(indicatorSpecKey(operand.indicator)) ?? null;
  }
}

type Comparator = Extract<Condition, { kind: "compare" }>["comparator"];

function compare(left: Decimal, comparator: Comparator, right: Decimal): boolean {
  switch (comparator) {
    case ">":
      return left.gt(right);
    case ">=":
      return left.gte(right);
    case "<":
      return left.lt(right);
    case "<=":
      return left.lte(right);
    case "==":
      return left.eq(right);
    case "!=":
      return !left.eq(right);
  }
}

function negate(verdict: Verdict): Verdict {
  if (verdict === "unknown") return "unknown";
  return verdict === "true" ? "false" : "true";
}

export function evaluateCondition(condition: Condition, ctx: ConditionContext): Verdict {
  switch (condition.kind) {
    case "compare": {
      const left = resolveOperand(condition.left, ctx);
      const right = resolveOperand(condition.right, ctx);
      if (left === null || right === null) return "unknown";
      return compare(left, condition.comparator, right) ? "true" : "false";
    }
    case "not":
      return negate(evaluateCondition(condition.condition, ctx));
    case "and": {
      const verdicts = condition.conditions.map((c) => evaluateCondition(c, ctx));
      if (verdicts.some((v) => v === "false")) return "false";
      if (verdicts.some((v) => v === "unknown")) return "unknown";
      return "true";
    }
    case "or": {
      const verdicts = condition.conditions.map((c) => evaluateCondition(c, ctx));
      if (verdicts.some((v) => v === "true")) return "true";
      if (verdicts.some((v) => v === "unknown")) return "unknown";
      return "false";
    }
  }
}
