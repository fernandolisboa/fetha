"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";

// A plain `<Input type="number" value={value} onChange={... Number(...)}>`
// turns a cleared field into `0` (`Number("") === 0`), silently rewriting
// the user's "empty while I finish typing" into a real value. This field
// keeps the raw string the user is typing in local state and only calls
// `onChange` once it parses to an integer at or above `min`; a cleared or
// otherwise invalid field is left uncommitted rather than coerced.
//
// `raw` resyncs from `value` by comparing against `committedValue` during
// render (React's documented way to adjust state in response to a prop
// change without an extra effect-triggered render:
// https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
export function NumberField({
  value,
  onChange,
  min,
  ariaLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  ariaLabel: string;
}) {
  const [raw, setRaw] = useState(String(value));
  const [committedValue, setCommittedValue] = useState(value);

  if (value !== committedValue) {
    setCommittedValue(value);
    setRaw(String(value));
  }

  return (
    <Input
      type="number"
      min={min}
      aria-label={ariaLabel}
      value={raw}
      onChange={(event) => {
        const next = event.target.value;
        setRaw(next);
        if (next.trim() === "") {
          return;
        }
        const parsed = Number(next);
        if (!Number.isInteger(parsed) || (min !== undefined && parsed < min)) {
          return;
        }
        onChange(parsed);
      }}
    />
  );
}
