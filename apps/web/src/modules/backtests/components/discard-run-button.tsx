"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { discardBacktestRunAction } from "../actions";
import { t } from "../strings";

// A non-terminal run's own release valve (ADR-0032's own residual, closed
// by ADR-0037): confirmed through the same Dialog pattern
// DeleteAccountDialog already uses for a destructive, unrecoverable action,
// rather than a bare click that could fire from a stray tap.
export function DiscardRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [stale, setStale] = useState(false);

  async function discard(): Promise<void> {
    setPending(true);
    setError(false);
    const result = await discardBacktestRunAction({ runId });
    setPending(false);
    if (result.status === "ok") {
      setOpen(false);
      router.refresh();
      return;
    }
    if (result.error === "not_found" || result.error === "not_discardable") {
      // Someone else finished, failed or already discarded this run since
      // the list was rendered: closing the dialog and refreshing shows its
      // current state instead of leaving a "try again" invite that could
      // only repeat the same answer.
      setOpen(false);
      setStale(true);
      router.refresh();
      return;
    }
    setError(true);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button type="button" variant="ghost" size="sm" />}>
          {t.discard.action}
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.discard.confirmTitle}</DialogTitle>
            <DialogDescription>{t.discard.confirmDescription}</DialogDescription>
          </DialogHeader>
          {error ? <p className="text-destructive text-xs">{t.discard.error}</p> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              {t.discard.cancel}
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => void discard()}
            >
              {t.discard.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {stale ? <p className="text-muted-foreground text-xs">{t.discard.stale}</p> : null}
    </div>
  );
}
