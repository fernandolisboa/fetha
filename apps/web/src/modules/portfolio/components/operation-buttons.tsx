"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import {
  groupFillsAction,
  ungroupOperationAction,
  type PortfolioActionResult,
} from "../portfolio-actions";
import { t } from "../strings";

function ActionButton({
  label,
  run,
}: {
  label: string;
  run: () => Promise<PortfolioActionResult>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError(null);
          startTransition(() => {
            run()
              .then((result) => {
                setPending(false);
                if (result.status === "ok") router.refresh();
                else setError(t.dashboard.errors[result.error]);
              })
              .catch(() => {
                setPending(false);
                setError(t.dashboard.errors.unavailable);
              });
          });
        }}
      >
        {label}
      </Button>
      {error && (
        <span role="alert" className="text-[11px]" style={{ color: "var(--danger)" }}>
          {error}
        </span>
      )}
    </span>
  );
}

export function UngroupButton({ operationId }: { operationId: string }) {
  return (
    <ActionButton
      label={t.dashboard.operations.ungroup}
      run={() => ungroupOperationAction(operationId)}
    />
  );
}

export function GroupExpiredButton({ fillIds }: { fillIds: string[] }) {
  return (
    <ActionButton
      label={t.dashboard.settlements.group}
      run={() => groupFillsAction({ fillIds, operationId: null })}
    />
  );
}
