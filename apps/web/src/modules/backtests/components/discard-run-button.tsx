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
import { ErrorNotice } from "@/components/error-notice";

import { discardBacktestRunAction } from "../actions";
import { t } from "../strings";

// A non-terminal run's own release valve (ADR-0032's own residual, closed
// by ADR-0037): confirmed through the same Dialog pattern
// DeleteAccountDialog already uses for a destructive, unrecoverable action,
// rather than a bare click that could fire from a stray tap.
export function DiscardRunButton({ runId, runLabel }: { runId: string; runLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<"generic" | "rate_limited" | null>(null);

  async function discard(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const result = await discardBacktestRunAction({ runId });
      if (result.status === "ok") {
        setOpen(false);
        router.refresh();
        return;
      }
      if (result.error === "not_found" || result.error === "not_discardable") {
        // Someone else finished, failed or already discarded this run since
        // the list was rendered: closing the dialog and refreshing shows its
        // current state, the same dialog the "ok" branch above leaves —
        // there is nothing stale left to say once the refreshed page
        // already reflects it.
        setOpen(false);
        router.refresh();
        return;
      }
      setError("rate_limited");
    } catch {
      setError("generic");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t.discard.actionAriaLabel(runLabel)}
          />
        }
      >
        {t.discard.action}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.discard.confirmTitle}</DialogTitle>
          <DialogDescription>{t.discard.confirmDescription}</DialogDescription>
        </DialogHeader>
        {error ? (
          <ErrorNotice>
            {error === "rate_limited" ? t.discard.rateLimited : t.discard.error}
          </ErrorNotice>
        ) : null}
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
  );
}
