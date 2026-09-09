"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { copySharedStrategyAction } from "../actions";

import { t } from "../strings";

export function CopyStrategyButton({ sourceStrategyId }: { sourceStrategyId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  function copy() {
    setPending(true);
    startTransition(() => {
      copySharedStrategyAction({ sourceStrategyId })
        .then((result) => {
          setPending(false);
          if (result.status === "ok") {
            router.push(`/estrategias/${result.strategyId}`);
          }
        })
        .catch(() => {
          setPending(false);
        });
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} disabled={pending}>
      {t.list.shared.copy}
    </Button>
  );
}
