"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";

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
export function RunBacktestButton({
  runId,
  label,
  autoStart = false,
}: {
  runId: string;
  label: string;
  autoStart?: boolean;
}) {
  const router = useRouter();
  const autoStarted = useRef(false);
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
      if (autoStart) {
        router.replace(window.location.pathname);
      } else {
        router.refresh();
      }
    } catch {
      setError(t.networkError);
    } finally {
      setPending(false);
    }
  }

  // A recipe lands here with a fresh run (docs/adr/0064): its first chunk
  // starts on arrival, once, even under Strict Mode's double effect.
  const startOnArrival = useEffectEvent(() => {
    void run();
  });
  useEffect(() => {
    if (autoStart && !autoStarted.current) {
      autoStarted.current = true;
      startOnArrival();
    }
  }, [autoStart]);

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={() => void run()} disabled={pending}>
        {pending ? t.report.running : label}
      </Button>
      {error ? (
        <ErrorNotice>
          {error}
          {tooManyActive ? (
            <>
              {" "}
              <Link href={IN_PROGRESS_RUNS_HREF} className="underline-offset-4 hover:underline">
                {t.inProgress.link}
              </Link>
            </>
          ) : null}
        </ErrorNotice>
      ) : null}
    </div>
  );
}
