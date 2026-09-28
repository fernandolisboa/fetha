"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";

import { unarchiveStrategyAction } from "../actions";
import { t } from "../strings";

export function UnarchiveStrategyButton({
  strategyId,
  strategyName,
}: {
  strategyId: string;
  strategyName: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"limit_reached" | "generic" | null>(null);

  function unarchive() {
    setError(null);
    setPending(true);
    startTransition(() => {
      unarchiveStrategyAction({ strategyId })
        .then((result) => {
          setPending(false);
          if (result.status !== "ok") {
            setError(result.error === "limit_reached" ? "limit_reached" : "generic");
            return;
          }
          router.refresh();
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
        onClick={unarchive}
        disabled={pending}
        aria-label={t.list.archived.unarchiveAriaLabel(strategyName)}
      >
        {t.list.archived.unarchive}
      </Button>
      {error && (
        <ErrorNotice>
          {error === "limit_reached"
            ? t.list.archived.unarchiveLimitReached
            : t.list.archived.unarchiveError}
        </ErrorNotice>
      )}
    </div>
  );
}
