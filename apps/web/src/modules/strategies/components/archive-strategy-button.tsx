"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";

import { archiveStrategyAction } from "../actions";
import { t } from "../strings";

// No confirmation dialog: archiving is reversible (unarchive), unlike
// DiscardRunButton's own confirmed action.
export function ArchiveStrategyButton({
  strategyId,
  strategyName,
}: {
  strategyId: string;
  strategyName: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"rate_limited" | "generic" | null>(null);

  function archive() {
    setError(null);
    setPending(true);
    startTransition(() => {
      archiveStrategyAction({ strategyId })
        .then((result) => {
          setPending(false);
          if (result.status !== "ok") {
            setError(result.error === "rate_limited" ? "rate_limited" : "generic");
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
        onClick={archive}
        disabled={pending}
        aria-label={t.list.mine.archiveAriaLabel(strategyName)}
      >
        {t.list.mine.archive}
      </Button>
      {error && (
        <ErrorNotice>
          {error === "rate_limited" ? t.list.rateLimited : t.list.mine.archiveError}
        </ErrorNotice>
      )}
    </div>
  );
}
