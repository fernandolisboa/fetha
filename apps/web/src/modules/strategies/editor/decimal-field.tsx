"use client";

import { useId, useState } from "react";
import { decimalStringSchema, type DecimalString } from "@fetha/contracts";

import { Input } from "@/components/ui/input";

import { t } from "../strings";
import { useFieldValidityRegistration } from "./field-validity";

// The same class of bug `NumberField` fixes, for decimal fields: casting
// `event.target.value as DecimalString` (the pattern this replaces) lets an
// unparseable string ("-", "0.", "1,5") reach the domain as if it were a
// validated `DecimalString`. This field keeps the raw string the user is
// typing in local state and only calls `onChange` once `schema` accepts it
// — an in-progress value like "0." is left uncommitted, marked
// `aria-invalid`, and registered with `FieldValidityProvider` so the form
// can refuse to submit while it stays uncommitted. `schema` defaults to the
// bare `decimalStringSchema` but callers with a narrower domain (a delta
// target, a sizing fraction) pass their own, so an out-of-range value is
// caught here instead of only at save time.
//
// `raw` resyncs from `value` by comparing against `committedValue` during
// render, the same prop-change pattern `NumberField` uses.
interface DecimalStringSchema {
  safeParse: (value: unknown) => { success: boolean };
}

export function DecimalField({
  value,
  onChange,
  ariaLabel,
  schema = decimalStringSchema,
}: {
  value: DecimalString;
  onChange: (value: DecimalString) => void;
  ariaLabel: string;
  // Every schema this accepts (openUnitIntervalSchema, leftOpenUnitIntervalSchema,
  // positiveDecimalSchema, ...) is decimalStringSchema with a tighter regex, so a
  // value it accepts is always a valid DecimalString too; re-parsing with
  // decimalStringSchema below gets the properly branded type back without a cast.
  schema?: DecimalStringSchema;
}) {
  const id = useId();
  const [raw, setRaw] = useState<string>(value);
  const [committedValue, setCommittedValue] = useState<DecimalString>(value);

  if (value !== committedValue) {
    setCommittedValue(value);
    setRaw(value);
  }

  const valid = schema.safeParse(raw).success;
  useFieldValidityRegistration(id, valid);

  return (
    <div className="flex flex-col gap-1">
      <Input
        aria-label={ariaLabel}
        aria-invalid={!valid}
        value={raw}
        onChange={(event) => {
          const next = event.target.value;
          setRaw(next);
          if (schema.safeParse(next).success) {
            onChange(decimalStringSchema.parse(next));
          }
        }}
      />
      {!valid && <p className="text-destructive text-xs">{t.editor.fieldInvalid}</p>}
    </div>
  );
}
