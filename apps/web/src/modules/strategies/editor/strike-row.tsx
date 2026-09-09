"use client";

import { strikeSelectionKinds, type DecimalString, type StrikeSelection } from "@fetha/contracts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { t } from "../strings";
import { SimpleSelect } from "./simple-select";

function defaultForKind(kind: StrikeSelection["kind"]): StrikeSelection {
  if (kind === "delta") return { kind: "delta", target: "0.3" as DecimalString };
  if (kind === "moneyness") return { kind: "moneyness", percent: "0" as DecimalString };
  return { kind: "nearest", price: "1" as DecimalString };
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
      <span className="text-muted-foreground w-6 text-xs">#{rank}</span>
      <div className="flex w-40 flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">{t.editor.strikes.kind}</span>
        <SimpleSelect
          ariaLabel={`${t.editor.strikes.kind} #${String(rank)}`}
          value={value.kind}
          onValueChange={(kind) => {
            onChange(defaultForKind(kind as StrikeSelection["kind"]));
          }}
          options={strikeSelectionKinds.map((kind) => ({ value: kind, label: kind }))}
        />
      </div>

      {value.kind === "delta" && (
        <Input
          aria-label={`${t.editor.strikes.delta.target} #${String(rank)}`}
          value={value.target}
          onChange={(event) => {
            onChange({ kind: "delta", target: event.target.value as DecimalString });
          }}
        />
      )}
      {value.kind === "moneyness" && (
        <Input
          aria-label={`${t.editor.strikes.moneyness.percent} #${String(rank)}`}
          value={value.percent}
          onChange={(event) => {
            onChange({ kind: "moneyness", percent: event.target.value as DecimalString });
          }}
        />
      )}
      {value.kind === "nearest" && (
        <Input
          aria-label={`${t.editor.strikes.nearest.price} #${String(rank)}`}
          value={value.price}
          onChange={(event) => {
            onChange({ kind: "nearest", price: event.target.value as DecimalString });
          }}
        />
      )}

      <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
        {t.editor.strikes.removeStrike}
      </Button>
    </div>
  );
}
