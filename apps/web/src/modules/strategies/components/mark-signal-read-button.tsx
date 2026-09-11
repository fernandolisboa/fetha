"use client";

import { startTransition, useState } from "react";

import { Button } from "@/components/ui/button";

import { markSignalReadAction } from "../actions";
import { t } from "../strings";

export function MarkSignalReadButton({ signalId, read }: { signalId: string; read: boolean }) {
  const [isRead, setIsRead] = useState(read);
  const [pending, setPending] = useState(false);

  if (isRead) {
    return <span className="text-muted-foreground text-xs">{t.inbox.read}</span>;
  }

  function markRead() {
    setPending(true);
    startTransition(() => {
      markSignalReadAction({ signalId })
        .then((result) => {
          setPending(false);
          if (result.status === "ok") {
            setIsRead(true);
          }
        })
        .catch(() => {
          setPending(false);
        });
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={markRead} disabled={pending}>
      {t.inbox.markRead}
    </Button>
  );
}
