"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { importFillsAction, type ImportFillsResult } from "../portfolio-actions";
import { t } from "../strings";

function describe(result: ImportFillsResult): { tone: "ok" | "error"; lines: string[] } {
  if (result.status === "ok") {
    const lines = [t.dashboard.importDialog.result(result.inserted, result.alreadyImported)];
    if (result.skipped.exercise + result.skipped.unsupported_market > 0) {
      lines.push(
        t.dashboard.importDialog.skipped(
          result.skipped.exercise,
          result.skipped.unsupported_market,
        ),
      );
    }
    return { tone: "ok", lines };
  }
  return {
    tone: "error",
    lines: [
      result.error === "invalid_row"
        ? t.dashboard.errors.invalid_row(result.row)
        : t.dashboard.errors[result.error],
    ],
  };
}

export function ImportFillsDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<{ tone: "ok" | "error"; lines: string[] } | null>(null);

  function submit(form: HTMLFormElement) {
    setPending(true);
    setOutcome(null);
    const data = new FormData(form);
    startTransition(() => {
      importFillsAction(data)
        .then((result) => {
          setPending(false);
          setOutcome(describe(result));
          if (result.status === "ok") {
            router.refresh();
          }
        })
        .catch(() => {
          setPending(false);
          setOutcome({ tone: "error", lines: [t.dashboard.errors.unavailable] });
        });
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setOutcome(null);
      }}
    >
      <DialogTrigger render={<Button type="button" />}>
        {t.dashboard.importSpreadsheet}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.dashboard.importDialog.title}</DialogTitle>
          <DialogDescription>{t.dashboard.importDialog.description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit(event.currentTarget);
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="import-file">{t.dashboard.importDialog.file}</Label>
            <Input
              id="import-file"
              name="file"
              type="file"
              required
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            />
          </div>
          {outcome && (
            <div
              role={outcome.tone === "error" ? "alert" : "status"}
              className="flex flex-col gap-1 text-[12px]"
              style={{ color: outcome.tone === "error" ? "var(--danger)" : undefined }}
            >
              {outcome.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {t.dashboard.importDialog.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
