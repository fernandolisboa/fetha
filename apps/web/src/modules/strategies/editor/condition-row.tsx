"use client";

import { comparators } from "@fetha/contracts";

import { Button } from "@/components/ui/button";

import { t } from "../strings";
import type { CompareCondition } from "./compare-conditions";
import { OperandField } from "./operand-field";
import { SimpleSelect } from "./simple-select";

export function ConditionRow({
  value,
  onChange,
  onRemove,
  removable,
}: {
  value: CompareCondition;
  onChange: (value: CompareCondition) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  return (
    <div className="border-line flex flex-wrap items-end gap-2 border-b pb-3 last:border-b-0">
      <OperandField
        label={t.editor.entry.leftOperand}
        value={value.left}
        onChange={(left) => {
          onChange({ ...value, left });
        }}
      />
      <div className="flex w-24 flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">{t.editor.entry.comparator}</span>
        <SimpleSelect
          ariaLabel={t.editor.entry.comparator}
          value={value.comparator}
          onValueChange={(comparator) => {
            onChange({ ...value, comparator: comparator as CompareCondition["comparator"] });
          }}
          options={comparators.map((comparator) => ({
            value: comparator,
            label: t.comparators[comparator],
          }))}
        />
      </div>
      <OperandField
        label={t.editor.entry.rightOperand}
        value={value.right}
        onChange={(right) => {
          onChange({ ...value, right });
        }}
      />
      {removable && (
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          {t.editor.entry.removeCondition}
        </Button>
      )}
    </div>
  );
}
