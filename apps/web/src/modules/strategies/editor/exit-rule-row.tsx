"use client";

import { exitRuleKinds, type DecimalString, type ExitRule } from "@fetha/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { defaultCompareCondition } from "./defaults";
import { compareConditionsToEntry, entryToCompareConditions } from "./compare-conditions";
import { ConditionRow } from "./condition-row";
import { t } from "../strings";
import { SimpleSelect } from "./simple-select";

function defaultForKind(kind: ExitRule["kind"]): ExitRule {
  if (kind === "profit_target")
    return { kind: "profit_target", fractionOfPremium: "0.5" as DecimalString };
  if (kind === "stop_loss") return { kind: "stop_loss", multipleOfMaxLoss: "1" as DecimalString };
  if (kind === "days_before_expiry") return { kind: "days_before_expiry", businessDays: 3 };
  return { kind: "condition", condition: defaultCompareCondition };
}

export function ExitRuleRow({
  value,
  onChange,
  onRemove,
  index,
  removable = true,
}: {
  value: ExitRule;
  onChange: (value: ExitRule) => void;
  onRemove: () => void;
  index: number;
  removable?: boolean;
}) {
  return (
    <div className="border-line flex flex-col gap-2 border-b pb-3 last:border-b-0">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex w-52 flex-col gap-1.5">
          <span className="text-muted-foreground text-xs">{t.editor.exit.kind}</span>
          <SimpleSelect
            ariaLabel={`${t.editor.exit.kind} #${String(index + 1)}`}
            value={value.kind}
            onValueChange={(kind) => {
              onChange(defaultForKind(kind as ExitRule["kind"]));
            }}
            options={exitRuleKinds.map((kind) => ({ value: kind, label: t.editor.exit[kind] }))}
          />
        </div>

        {value.kind === "profit_target" && (
          <Input
            aria-label={`${t.editor.exit.fractionOfPremium} #${String(index + 1)}`}
            value={value.fractionOfPremium}
            onChange={(event) => {
              onChange({
                kind: "profit_target",
                fractionOfPremium: event.target.value as DecimalString,
              });
            }}
          />
        )}
        {value.kind === "stop_loss" && (
          <Input
            aria-label={`${t.editor.exit.multipleOfMaxLoss} #${String(index + 1)}`}
            value={value.multipleOfMaxLoss}
            onChange={(event) => {
              onChange({
                kind: "stop_loss",
                multipleOfMaxLoss: event.target.value as DecimalString,
              });
            }}
          />
        )}
        {value.kind === "days_before_expiry" && (
          <Input
            type="number"
            min={0}
            aria-label={`${t.editor.exit.businessDays} #${String(index + 1)}`}
            value={value.businessDays}
            onChange={(event) => {
              onChange({ kind: "days_before_expiry", businessDays: Number(event.target.value) });
            }}
          />
        )}

        {removable && (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            {t.editor.exit.removeRule}
          </Button>
        )}
      </div>

      {value.kind === "condition" && (
        <ConditionRow
          removable={false}
          onRemove={() => undefined}
          value={
            entryToCompareConditions(value.condition, defaultCompareCondition)[0] ??
            defaultCompareCondition
          }
          onChange={(condition) => {
            onChange({ kind: "condition", condition: compareConditionsToEntry([condition]) });
          }}
        />
      )}
    </div>
  );
}
