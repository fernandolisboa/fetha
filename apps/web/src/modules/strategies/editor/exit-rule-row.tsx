"use client";

import { decimalStringSchema, exitRuleKinds, type ExitRule } from "@fetha/contracts";

import { Button } from "@/components/ui/button";

import { t } from "../strings";
import { toEditableExitCondition } from "./compare-conditions";
import { ConditionRow } from "./condition-row";
import { DecimalField } from "./decimal-field";
import { defaultCompareCondition } from "./defaults";
import { NumberField } from "./number-field";
import { SimpleSelect } from "./simple-select";

function defaultForKind(kind: ExitRule["kind"]): ExitRule {
  switch (kind) {
    case "profit_target":
      return { kind: "profit_target", fractionOfPremium: decimalStringSchema.parse("0.5") };
    case "stop_loss":
      return { kind: "stop_loss", multipleOfMaxLoss: decimalStringSchema.parse("1") };
    case "days_before_expiry":
      return { kind: "days_before_expiry", businessDays: 3 };
    case "condition":
      return { kind: "condition", condition: defaultCompareCondition };
  }
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
          <DecimalField
            ariaLabel={`${t.editor.exit.fractionOfPremium} #${String(index + 1)}`}
            value={value.fractionOfPremium}
            onChange={(fractionOfPremium) => {
              onChange({ kind: "profit_target", fractionOfPremium });
            }}
          />
        )}
        {value.kind === "stop_loss" && (
          <DecimalField
            ariaLabel={`${t.editor.exit.multipleOfMaxLoss} #${String(index + 1)}`}
            value={value.multipleOfMaxLoss}
            onChange={(multipleOfMaxLoss) => {
              onChange({ kind: "stop_loss", multipleOfMaxLoss });
            }}
          />
        )}
        {value.kind === "days_before_expiry" && (
          <NumberField
            min={0}
            ariaLabel={`${t.editor.exit.businessDays} #${String(index + 1)}`}
            value={value.businessDays}
            onChange={(businessDays) => {
              onChange({ kind: "days_before_expiry", businessDays });
            }}
          />
        )}

        {removable && (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            {t.editor.exit.removeRule}
          </Button>
        )}
      </div>

      {value.kind === "condition" &&
        (() => {
          const editable = toEditableExitCondition(value.condition);
          if (!editable.editable) {
            return <p className="text-muted-foreground text-sm">{t.editor.exit.readOnlyNotice}</p>;
          }
          return (
            <ConditionRow
              removable={false}
              onRemove={() => undefined}
              value={editable.condition}
              onChange={(condition) => {
                onChange({ kind: "condition", condition });
              }}
            />
          );
        })()}
    </div>
  );
}
