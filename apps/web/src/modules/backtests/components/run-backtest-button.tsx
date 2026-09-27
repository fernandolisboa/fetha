"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { t } from "../strings";

async function refusedForActiveCap(response: Response): Promise<boolean> {
  if (response.status !== 409) {
    return false;
  }
  const body: unknown = await response.json().catch(() => null);
  return (
    typeof body === "object" && body !== null && "error" in body && body.error === "too_many_active"
  );
}

// Chunk-and-resume from the client: each click only awaits one budgeted
// call to the route handler, then refreshes the
// Server Component with the freshly persisted status; a paused run shows
// the same button labeled "Continuar" for the next chunk instead of the
// client looping on its own, so a page reload never loses progress.
export function RunBacktestButton({ runId, label }: { runId: string; label: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/backtests/${runId}/run`, { method: "POST" });
      if (!response.ok) {
        setError(
          (await refusedForActiveCap(response))
            ? t.tooManyActive
            : t.report.failed.replace("{error}", String(response.status)),
        );
        return;
      }
      router.refresh();
    } catch {
      setError(t.networkError);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={() => void run()} disabled={pending}>
        {pending ? t.report.running : label}
      </Button>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
