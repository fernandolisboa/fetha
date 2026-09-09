"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { copySharedStrategyAction } from "../actions";

import { t } from "../strings";

export function CopyStrategyButton({ sourceStrategyId }: { sourceStrategyId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  function copy() {
    setError(false);
    setPending(true);
    startTransition(() => {
      copySharedStrategyAction({ sourceStrategyId })
        .then((result) => {
          setPending(false);
          if (result.status === "ok") {
            router.push(`/estrategias/${result.strategyId}`);
          } else {
            setError(true);
          }
        })
        .catch(() => {
          setPending(false);
          setError(true);
        });
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" size="sm" onClick={copy} disabled={pending}>
        {t.list.shared.copy}
      </Button>
      {error && <p className="text-destructive text-xs">{t.list.shared.copyError}</p>}
    </div>
  );
}
