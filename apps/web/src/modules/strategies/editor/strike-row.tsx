"use client";

import {
  strikeSelectionKinds,
  decimalStringSchema,
  openUnitIntervalSchema,
  positiveDecimalSchema,
  type StrikeSelection,
} from "@fetha/contracts";

import { Button } from "@/components/ui/button";

import { t } from "../strings";
import { DecimalField } from "./decimal-field";
import { SimpleSelect } from "./simple-select";

function defaultForKind(kind: StrikeSelection["kind"]): StrikeSelection {
  switch (kind) {
    case "delta":
      return { kind: "delta", target: decimalStringSchema.parse("0.3") };
    case "moneyness":
      return { kind: "moneyness", percent: decimalStringSchema.parse("0") };
    case "nearest":
      return { kind: "nearest", price: decimalStringSchema.parse("1") };
  }
}

export function StrikeRow({
  value,
  onChange,
  onRemove,
  rank,
  removable = true,
}: {
  value: StrikeSelection;
  onChange: (value: StrikeSelection) => void;
  onRemove: () => void;
  rank: number;
  removable?: boolean;
}) {
  return (
    <div className="@container">
      <div className="grid grid-cols-[1.5rem_minmax(0,10rem)_6rem] items-end gap-2 @min-[28rem]:grid-cols-[1.5rem_10rem_7rem_auto]">
        <span className="text-muted-foreground font-mono text-xs tabular-nums">#{rank}</span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-muted-foreground text-xs">{t.editor.strikes.kind}</span>
          <SimpleSelect
            ariaLabel={`${t.editor.strikes.kind} #${String(rank)}`}
            value={value.kind}
            onValueChange={(kind) => {
              onChange(defaultForKind(kind));
            }}
            options={strikeSelectionKinds.map((kind) => ({
              value: kind,
              label: t.editor.strikes.kinds[kind],
            }))}
          />
        </div>

        <div>
          {value.kind === "delta" && (
            <DecimalField
              ariaLabel={`${t.editor.strikes.delta.target} #${String(rank)}`}
              value={value.target}
              schema={openUnitIntervalSchema}
              onChange={(target) => {
                onChange({ kind: "delta", target });
              }}
            />
          )}
          {value.kind === "moneyness" && (
            <DecimalField
              ariaLabel={`${t.editor.strikes.moneyness.percent} #${String(rank)}`}
              value={value.percent}
              onChange={(percent) => {
                onChange({ kind: "moneyness", percent });
              }}
            />
          )}
          {value.kind === "nearest" && (
            <DecimalField
              ariaLabel={`${t.editor.strikes.nearest.price} #${String(rank)}`}
              value={value.price}
              schema={positiveDecimalSchema}
              onChange={(price) => {
                onChange({ kind: "nearest", price });
              }}
            />
          )}
        </div>

        {removable && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="col-start-2 justify-self-start @min-[28rem]:col-start-auto"
            onClick={onRemove}
          >
            {t.editor.strikes.removeStrike}
          </Button>
        )}
      </div>
    </div>
  );
}
