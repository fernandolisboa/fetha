"use client";

import { startTransition, useState } from "react";

import { Button } from "@/components/ui/button";
import { setStrategyVisibilityAction } from "../actions";

import { t } from "../strings";
import type { StrategyVisibility } from "../strategies-repository";

export function ShareToggleButton({
  strategyId,
  visibility,
}: {
  strategyId: string;
  visibility: StrategyVisibility;
}) {
  const [current, setCurrent] = useState(visibility);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  function toggle() {
    const previous = current;
    const next: StrategyVisibility = previous === "shared" ? "private" : "shared";
    setCurrent(next);
    setError(false);
    setPending(true);
    startTransition(() => {
      setStrategyVisibilityAction({ strategyId, visibility: next })
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
      <Button type="button" variant="outline" size="sm" onClick={toggle} disabled={pending}>
        {current === "shared" ? t.list.mine.unshare : t.list.mine.share}
      </Button>
      {error && <p className="text-destructive text-xs">{t.list.mine.shareError}</p>}
    </div>
  );
}
