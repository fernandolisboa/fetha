"use client";

import { useId, useState } from "react";

import { Input } from "@/components/ui/input";

import { t } from "../strings";
import { useFieldValidityRegistration } from "./field-validity";
import { isValidWholeNumber } from "./is-valid-whole-number";

// A plain `<Input type="number" value={value} onChange={... Number(...)}>`
// turns a cleared field into `0` (`Number("") === 0`), silently rewriting
// the user's "empty while I finish typing" into a real value. This field
// keeps the raw string the user is typing in local state and only calls
// `onChange` once it parses to an integer at or above `min`; a cleared or
// otherwise invalid field is left uncommitted rather than coerced, marked
// `aria-invalid`, and registered with `FieldValidityProvider` so the form
// can refuse to submit while it stays uncommitted.
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
  const id = useId();
  const [raw, setRaw] = useState(String(value));
  const [committedValue, setCommittedValue] = useState(value);

  if (value !== committedValue) {
    setCommittedValue(value);
    setRaw(String(value));
  }

  const valid = isValidWholeNumber(raw, min);
  useFieldValidityRegistration(id, valid);

  return (
    <div className="flex flex-col gap-1">
      <Input
        type="number"
        min={min}
        aria-label={ariaLabel}
        aria-invalid={!valid}
        value={raw}
        onChange={(event) => {
          const next = event.target.value;
          setRaw(next);
          if (isValidWholeNumber(next, min)) {
            onChange(Number(next.trim()));
          }
        }}
      />
      {!valid && <p className="text-destructive text-xs">{t.editor.fieldInvalid}</p>}
    </div>
  );
}
