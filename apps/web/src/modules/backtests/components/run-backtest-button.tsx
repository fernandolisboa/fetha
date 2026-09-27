"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { IN_PROGRESS_RUNS_HREF, t } from "../strings";

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
  const [tooManyActive, setTooManyActive] = useState(false);

  async function run(): Promise<void> {
    setPending(true);
    setError(null);
    setTooManyActive(false);
    try {
      const response = await fetch(`/api/backtests/${runId}/run`, { method: "POST" });
      if (!response.ok) {
        if (await refusedForActiveCap(response)) {
          setError(t.tooManyActive);
          setTooManyActive(true);
        } else {
          setError(t.report.failed.replace("{error}", String(response.status)));
        }
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
      {error ? (
        <p className="text-destructive text-xs">
          {error}
          {tooManyActive ? (
            <>
              {" "}
              <Link href={IN_PROGRESS_RUNS_HREF} className="underline-offset-4 hover:underline">
                {t.inProgress.link}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
