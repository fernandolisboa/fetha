"use client";

import { useState } from "react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import { compareHref, MAX_COMPARED_RUNS } from "../comparison";
import { t } from "../strings";

export type PickerRun = { id: string; label: string; period: string };
export type PickerGroup = { strategyId: string; strategyName: string; runs: PickerRun[] };

export function CompareRunsPicker({
  groups,
  initialSelection,
}: {
  groups: PickerGroup[];
  initialSelection: string[];
}) {
  const [selected, setSelected] = useState<string[]>(initialSelection);
  const full = selected.length >= MAX_COMPARED_RUNS;

  function toggle(id: string): void {
    setSelected((current) =>
      current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id],
    );
  }

  if (groups.length === 0) {
    return <p className="text-muted-foreground text-sm">{t.compare.pickEmpty}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-xs">{t.compare.pickHint}</p>
      {groups.map((group) => (
        <fieldset key={group.strategyId} className="flex flex-col gap-1">
          <legend className="text-muted-foreground mb-1 text-[11px] tracking-[0.06em] uppercase">
            {group.strategyName}
          </legend>
          {group.runs.map((run) => {
            const checked = selected.includes(run.id);
            return (
              <label
                key={run.id}
                className={cn(
                  "flex min-h-8 items-center gap-2 text-sm",
                  !checked && full ? "text-muted-foreground" : null,
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={!checked && full}
                  onCheckedChange={() => {
                    toggle(run.id);
                  }}
                />
                <span className="font-mono tabular-nums">{run.label}</span>
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {run.period}
                </span>
              </label>
            );
          })}
        </fieldset>
      ))}
      {selected.length >= 2 ? (
        <Link href={compareHref(selected)} className={buttonVariants()}>
          {t.compare.pickSubmit}
        </Link>
      ) : (
        <p className="text-muted-foreground text-xs">{t.compare.tooFew}</p>
      )}
    </div>
  );
}
