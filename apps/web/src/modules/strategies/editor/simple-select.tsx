"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface SimpleSelectOption {
  value: string;
  label: string;
}

export function SimpleSelect({
  value,
  onValueChange,
  options,
  ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SimpleSelectOption[];
  ariaLabel: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") {
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
