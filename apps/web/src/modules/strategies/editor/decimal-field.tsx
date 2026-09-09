"use client";

import { useState } from "react";
import { decimalStringSchema, type DecimalString } from "@fetha/contracts";

import { Input } from "@/components/ui/input";

// The same class of bug `NumberField` fixes, for decimal fields: casting
// `event.target.value as DecimalString` (the pattern this replaces) lets an
// unparseable string ("-", "0.", "1,5") reach the domain as if it were a
// validated `DecimalString`. This field keeps the raw string the user is
// typing in local state and only calls `onChange` once
// `decimalStringSchema` accepts it — an in-progress value like "0." is left
// uncommitted rather than forced through a cast.
//
// `raw` resyncs from `value` by comparing against `committedValue` during
// render, the same prop-change pattern `NumberField` uses.
export function DecimalField({
  value,
  onChange,
  ariaLabel,
}: {
  value: DecimalString;
  onChange: (value: DecimalString) => void;
  ariaLabel: string;
}) {
  const [raw, setRaw] = useState<string>(value);
  const [committedValue, setCommittedValue] = useState<DecimalString>(value);

  if (value !== committedValue) {
    setCommittedValue(value);
    setRaw(value);
  }

  return (
    <Input
      aria-label={ariaLabel}
      value={raw}
      onChange={(event) => {
        const next = event.target.value;
        setRaw(next);
        const parsed = decimalStringSchema.safeParse(next);
        if (parsed.success) {
          onChange(parsed.data);
        }
      }}
    />
  );
}
