"use client";

import type { ExpirySelection } from "@fetha/contracts";

import { Input } from "@/components/ui/input";

import { t } from "../strings";

export function ExpiryFields({
  value,
  onChange,
}: {
  value: ExpirySelection;
  onChange: (value: ExpirySelection) => void;
}) {
  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">{t.editor.expiry.min}</span>
        <Input
          type="number"
          min={1}
          aria-label={t.editor.expiry.min}
          value={value.min}
          onChange={(event) => {
            onChange({ kind: "business_days", min: Number(event.target.value), max: value.max });
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">{t.editor.expiry.max}</span>
        <Input
          type="number"
          min={1}
          aria-label={t.editor.expiry.max}
          value={value.max}
          onChange={(event) => {
            onChange({ kind: "business_days", min: value.min, max: Number(event.target.value) });
          }}
        />
      </div>
    </div>
  );
}
