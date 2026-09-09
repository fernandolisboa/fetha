"use client";

import type { ExpirySelection } from "@fetha/contracts";

import { t } from "../strings";
import { NumberField } from "./number-field";

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
        <NumberField
          min={1}
          ariaLabel={t.editor.expiry.min}
          value={value.min}
          onChange={(min) => {
            onChange({ kind: "business_days", min, max: value.max });
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">{t.editor.expiry.max}</span>
        <NumberField
          min={1}
          ariaLabel={t.editor.expiry.max}
          value={value.max}
          onChange={(max) => {
            onChange({ kind: "business_days", min: value.min, max });
          }}
        />
      </div>
    </div>
  );
}
