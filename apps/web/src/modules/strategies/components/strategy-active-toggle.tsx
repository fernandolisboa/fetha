"use client";

import { startTransition, useState } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import { setStrategyActiveAction } from "../actions";
import { t } from "../strings";

export function StrategyActiveToggle({
  strategyId,
  active,
}: {
  strategyId: string;
  active: boolean;
}) {
  const [current, setCurrent] = useState(active);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const inputId = `strategy-active-${strategyId}`;

  function toggle(next: boolean) {
    const previous = current;
    setCurrent(next);
    setError(false);
    setPending(true);
    startTransition(() => {
      setStrategyActiveAction({ strategyId, active: next })
        .then((result) => {
          setPending(false);
          if (result.status !== "ok") {
            setCurrent(previous);
            setError(true);
          }
        })
        .catch(() => {
          setPending(false);
          setCurrent(previous);
          setError(true);
        });
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Label htmlFor={inputId} className="text-muted-foreground text-xs">
          {t.active.label}
        </Label>
        <Switch
          id={inputId}
          checked={current}
          onCheckedChange={toggle}
          disabled={pending}
          aria-label={t.active.label}
        />
      </div>
      {error && <p className="text-destructive text-xs">{t.active.error}</p>}
    </div>
  );
}
