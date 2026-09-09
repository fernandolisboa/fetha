"use client";

import { strikeSelectionKinds, decimalStringSchema, type StrikeSelection } from "@fetha/contracts";

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
}: {
  value: StrikeSelection;
  onChange: (value: StrikeSelection) => void;
  onRemove: () => void;
  rank: number;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <span className="text-muted-foreground w-6 font-mono text-xs tabular-nums">#{rank}</span>
      <div className="flex w-40 flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">{t.editor.strikes.kind}</span>
        <SimpleSelect
          ariaLabel={`${t.editor.strikes.kind} #${String(rank)}`}
          value={value.kind}
          onValueChange={(kind) => {
            onChange(defaultForKind(kind as StrikeSelection["kind"]));
          }}
          options={strikeSelectionKinds.map((kind) => ({
            value: kind,
            label: t.editor.strikes.kinds[kind],
          }))}
        />
      </div>

      {value.kind === "delta" && (
        <DecimalField
          ariaLabel={`${t.editor.strikes.delta.target} #${String(rank)}`}
          value={value.target}
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
          onChange={(price) => {
            onChange({ kind: "nearest", price });
          }}
        />
      )}

      <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
        {t.editor.strikes.removeStrike}
      </Button>
    </div>
  );
}
