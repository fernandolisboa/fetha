"use client";

import type { DecimalString, StrikeSelection } from "@fetha/contracts";

import { Button } from "@/components/ui/button";

import { t } from "../strings";
import { StrikeRow } from "./strike-row";

function newStrike(): StrikeSelection {
  return { kind: "delta", target: "0.3" as DecimalString };
}

export function StrikeList({
  strikes,
  onChange,
}: {
  strikes: StrikeSelection[];
  onChange: (strikes: StrikeSelection[]) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {strikes.map((strike, index) => (
        <StrikeRow
          key={index}
          rank={index + 1}
          value={strike}
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
