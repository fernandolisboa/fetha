"use client";

import { sizingRuleKinds, type DecimalString, type SizingRule } from "@fetha/contracts";

import { Input } from "@/components/ui/input";

import { t } from "../strings";
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
            onChange({ kind: kind as SizingRule["kind"], fraction: value.fraction });
          }}
          options={sizingRuleKinds.map((kind) => ({ value: kind, label: t.editor.sizing[kind] }))}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">{t.editor.sizing.fraction}</span>
        <Input
          aria-label={t.editor.sizing.fraction}
          value={value.fraction}
          onChange={(event) => {
            onChange({ kind: value.kind, fraction: event.target.value as DecimalString });
          }}
        />
      </div>
    </div>
  );
}
