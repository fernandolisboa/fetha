import type { Condition, IndicatorSpec, StrategyDefinition } from "@fetha/contracts";

export function collectSpecsFromCondition(condition: Condition): IndicatorSpec[] {
  const specs: IndicatorSpec[] = [];
  const visit = (c: Condition): void => {
    if (c.kind === "compare") {
      if (c.left.kind === "indicator") specs.push(c.left.indicator);
      if (c.right.kind === "indicator") specs.push(c.right.indicator);
      return;
    }
    if (c.kind === "not") {
      visit(c.condition);
      return;
    }
    c.conditions.forEach(visit);
  };
  visit(condition);
  return specs;
}

export function collectIndicatorSpecs(definition: StrategyDefinition): IndicatorSpec[] {
  const specs = collectSpecsFromCondition(definition.entry);
  for (const rule of definition.exit) {
    if (rule.kind === "condition") specs.push(...collectSpecsFromCondition(rule.condition));
  }
  for (const rule of definition.adjustments) {
    if (rule.when.kind === "condition")
      specs.push(...collectSpecsFromCondition(rule.when.condition));
  }
  return specs;
}

export function indicatorSpecKey(spec: IndicatorSpec): string {
  return spec.kind === "iv_rank"
    ? `iv_rank:${String(spec.lookbackSessions)}`
    : `${spec.kind}:${String(spec.length)}`;
}

export function dedupeIndicatorSpecs(specs: readonly IndicatorSpec[]): IndicatorSpec[] {
  const seen = new Map<string, IndicatorSpec>();
  for (const spec of specs) seen.set(indicatorSpecKey(spec), spec);
  return [...seen.values()];
}
