"use client";

import { sizingRuleKinds, type SizingRule } from "@fetha/contracts";

import { t } from "../strings";
import { DecimalField } from "./decimal-field";
import { SimpleSelect } from "./simple-select";

export function SizingFields({
  value,
  onChange,
}: {
  value: SizingRule;
  onChange: (value: SizingRule) => void;
}) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex w-48 flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">{t.editor.sizing.kind}</span>
        <SimpleSelect
          ariaLabel={t.editor.sizing.kind}
          value={value.kind}
          onValueChange={(kind) => {
            onChange({ kind, fraction: value.fraction });
          }}
          options={sizingRuleKinds.map((kind) => ({ value: kind, label: t.editor.sizing[kind] }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">{t.editor.sizing.fraction}</span>
        <DecimalField
          ariaLabel={t.editor.sizing.fraction}
          value={value.fraction}
          onChange={(fraction) => {
            onChange({ kind: value.kind, fraction });
          }}
        />
      </div>
    </div>
  );
}
