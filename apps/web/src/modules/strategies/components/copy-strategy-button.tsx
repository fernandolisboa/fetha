"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";
import { copySharedStrategyAction } from "../actions";

import { t } from "../strings";

export function CopyStrategyButton({
  sourceStrategyId,
  strategyName,
}: {
  sourceStrategyId: string;
  strategyName: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"rate_limited" | "generic" | null>(null);

  function copy() {
    setError(null);
    setPending(true);
    startTransition(() => {
      copySharedStrategyAction({ sourceStrategyId })
        .then((result) => {
          setPending(false);
          if (result.status === "ok") {
            router.push(`/estrategias/${result.strategyId}`);
          } else {
            setError(result.error === "rate_limited" ? "rate_limited" : "generic");
          }
        })
        .catch(() => {
          setPending(false);
          setError("generic");
        });
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={copy}
        disabled={pending}
        aria-label={t.list.shared.copyAriaLabel(strategyName)}
      >
        {t.list.shared.copy}
      </Button>
      {error && (
        <ErrorNotice>
          {error === "rate_limited" ? t.list.rateLimited : t.list.shared.copyError}
        </ErrorNotice>
      )}
    </div>
  );
}
