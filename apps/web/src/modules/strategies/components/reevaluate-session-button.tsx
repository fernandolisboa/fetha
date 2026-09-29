"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";

import { reevaluateSessionAction, type ReevaluateSessionResult } from "../actions";
import { t, type MessageParts } from "../strings";

interface Message {
  parts: MessageParts;
  error: boolean;
}

function messageFor(result: ReevaluateSessionResult): Message {
  const copy = t.inbox.evaluationLog.reevaluation;
  switch (result.status) {
    case "applied":
      return { parts: copy.applied(result.counts), error: false };
    case "unchanged":
      return { parts: [copy.unchanged], error: false };
    case "failed":
      return { parts: [copy.failed], error: true };
    case "error":
      return {
        parts: [result.error === "invalid" ? copy.generic : copy[result.error]],
        error: true,
      };
  }
}

function renderParts(parts: MessageParts) {
  return parts.map((part, index) =>
    typeof part === "number" ? (
      <span key={index} className="font-mono tabular-nums">
        {part}
      </span>
    ) : (
      part
    ),
  );
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
  const [message, setMessage] = useState<Message | null>(null);

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
          setMessage({ parts: [t.inbox.evaluationLog.reevaluation.generic], error: true });
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
            <ErrorNotice>{renderParts(message.parts)}</ErrorNotice>
          ) : (
            <p className="text-muted-foreground text-xs">{renderParts(message.parts)}</p>
          ))}
      </div>
    </div>
  );
}
