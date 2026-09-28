"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";

import { reevaluateSessionAction, type ReevaluateSessionResult } from "../actions";
import { t } from "../strings";

function messageFor(result: ReevaluateSessionResult): { text: string; error: boolean } {
  const copy = t.inbox.evaluationLog.reevaluation;
  switch (result.status) {
    case "applied":
      return { text: copy.applied(result.counts), error: false };
    case "unchanged":
      return { text: copy.unchanged, error: false };
    case "failed":
      return { text: copy.failed, error: true };
    case "error":
      return {
        text: result.error === "invalid" ? copy.generic : copy[result.error],
        error: true,
      };
  }
}

export function ReevaluateSessionButton({
  strategyId,
  strategyName,
  session,
  sessionLabel,
}: {
  strategyId: string;
  strategyName: string;
  session: string;
  sessionLabel: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  function reevaluate() {
    setMessage(null);
    setPending(true);
    startTransition(() => {
      reevaluateSessionAction({ strategyId, session })
        .then((result) => {
          setPending(false);
          setMessage(messageFor(result));
          if (result.status === "applied") {
            router.refresh();
          }
        })
        .catch(() => {
          setPending(false);
          setMessage({ text: t.inbox.evaluationLog.reevaluation.generic, error: true });
        });
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={reevaluate}
        disabled={pending}
        aria-label={t.inbox.evaluationLog.reevaluateAriaLabel(strategyName, sessionLabel)}
      >
        {t.inbox.evaluationLog.reevaluate}
      </Button>
      <div role="status" aria-live="polite">
        {message &&
          (message.error ? (
            <ErrorNotice>{message.text}</ErrorNotice>
          ) : (
            <p className="text-muted-foreground text-xs">{message.text}</p>
          ))}
      </div>
    </div>
  );
}
