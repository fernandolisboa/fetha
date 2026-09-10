"use client";

import { decimalStringSchema, type StrikeSelection } from "@fetha/contracts";

import { Button } from "@/components/ui/button";

import { t } from "../strings";
import { StrikeRow } from "./strike-row";

function newStrike(): StrikeSelection {
  return { kind: "delta", target: decimalStringSchema.parse("0.3") };
}

export function StrikeList({
  strikes,
  onChange,
  minStrikes = 0,
}: {
  strikes: StrikeSelection[];
  onChange: (strikes: StrikeSelection[]) => void;
  // A roll adjustment's strikes must have at least one entry
  // (adjustmentRuleSchema.min(1)); the top-level entry strikes have no such
  // floor since a stock-only structure has none at all. Callers set
  // minStrikes to keep the remove button from ever leaving fewer rows than
  // the schema would accept.
  minStrikes?: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      {strikes.map((strike, index) => (
        <StrikeRow
          key={index}
          rank={index + 1}
          value={strike}
          removable={strikes.length > minStrikes}
          onChange={(next) => {
            onChange(strikes.map((s, i) => (i === index ? next : s)));
          }}
          onRemove={() => {
            onChange(strikes.filter((_, i) => i !== index));
          }}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => {
          onChange([...strikes, newStrike()]);
        }}
      >
        {t.editor.strikes.addStrike}
      </Button>
    </div>
  );
}
