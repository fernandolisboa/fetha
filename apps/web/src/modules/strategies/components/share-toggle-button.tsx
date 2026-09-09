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

  function toggle() {
    const previous = current;
    const next: StrategyVisibility = previous === "shared" ? "private" : "shared";
    setCurrent(next);
    setPending(true);
    startTransition(() => {
      setStrategyVisibilityAction({ strategyId, visibility: next })
        .then((result) => {
          setPending(false);
          if (result.status !== "ok") {
            setCurrent(previous);
          }
        })
        .catch(() => {
          setPending(false);
          setCurrent(previous);
        });
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={toggle} disabled={pending}>
      {current === "shared" ? t.list.mine.unshare : t.list.mine.share}
    </Button>
  );
}
