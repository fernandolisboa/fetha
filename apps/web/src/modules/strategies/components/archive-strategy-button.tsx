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
  const [error, setError] = useState(false);

  function archive() {
    setError(false);
    setPending(true);
    startTransition(() => {
      archiveStrategyAction({ strategyId })
        .then((result) => {
          setPending(false);
          if (result.status !== "ok") {
            setError(true);
            return;
          }
          router.refresh();
        })
        .catch(() => {
          setPending(false);
          setError(true);
        });
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={archive}
        disabled={pending}
        aria-label={t.list.mine.archiveAriaLabel(strategyName)}
      >
        {t.list.mine.archive}
      </Button>
      {error && <ErrorNotice>{t.list.mine.archiveError}</ErrorNotice>}
    </div>
  );
}
