"use client";

import type { AdjustmentRule, StrikeSelection } from "@fetha/contracts";

import { Button } from "@/components/ui/button";

import { t } from "../strings";
import { ExitRuleRow } from "./exit-rule-row";
import { ExpiryFields } from "./expiry-fields";
import { StrikeList } from "./strike-list";

export function AdjustmentRow({
  value,
  onChange,
  onRemove,
  index,
}: {
  value: AdjustmentRule;
  onChange: (value: AdjustmentRule) => void;
  onRemove: () => void;
  index: number;
}) {
  return (
    <div className="border-line flex flex-col gap-3 border-b pb-4 last:border-b-0">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{t.editor.adjustments.when}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
          {t.editor.adjustments.removeAdjustment}
        </Button>
      </div>
      <ExitRuleRow
        index={index}
        removable={false}
        value={value.when}
        onChange={(when) => {
          onChange({ ...value, when });
        }}
        onRemove={() => undefined}
      />
      <ExpiryFields
        value={value.expiry}
        onChange={(expiry) => {
          onChange({ ...value, expiry });
        }}
      />
      <StrikeList
        strikes={value.strikes}
        onChange={(strikes: StrikeSelection[]) => {
          onChange({ ...value, strikes });
        }}
      />
    </div>
  );
}
