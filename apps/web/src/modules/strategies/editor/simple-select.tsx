"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface SimpleSelectOption<T extends string> {
  value: T;
  label: string;
}

// Generic over the option list so `onValueChange` narrows to the union the
// caller actually offers, instead of `string`: the caller passes the
// contracts' own enum arrays (`comparators`, `exitRuleKinds`, ...) as
// `options`, and a value Radix's underlying DOM select could never produce
// (any string outside that list) is dropped rather than cast past the type
// system.
export function SimpleSelect<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: SimpleSelectOption<T>[];
  ariaLabel: string;
}) {
  const values = new Set<string>(options.map((option) => option.value));
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string" && values.has(next)) {
          onValueChange(next);
        }
      }}
    >
      <SelectTrigger aria-label={ariaLabel} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
