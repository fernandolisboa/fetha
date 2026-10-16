"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AnalysisSubjectKind } from "@fetha/contracts";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorNotice } from "@/components/error-notice";

import { requestAnalysisAction } from "../analysis-actions";
import { t } from "../strings";

import { analysisErrorMessage } from "./analysis-error-message";

interface RequestAnalysisButtonProps {
  subjectKind: AnalysisSubjectKind;
  subjectId: string;
  hasExistingAnalysis: boolean;
  usage: { used: number; cap: number };
  available: boolean;
}

// Requesting an analysis is a Server Action behind `useTransition`
// (DESIGN.md: "Requesting an analysis is the header's primary action" on the
// backtest report, a per-row trigger elsewhere); Opus can take up to a
// minute, so the pending state shows a skeleton where the panel will land.
export function RequestAnalysisButton({
  subjectKind,
  subjectId,
  hasExistingAnalysis,
  usage,
  available,
}: RequestAnalysisButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const label = hasExistingAnalysis ? t.analysis.request.triggerAgain : t.analysis.request.trigger;

  // The new analysis shows where the latest one already renders (the
  // dialog, or the report's panel) once the refresh lands, so it is never
  // drawn twice; the transition stays pending until then.
  function request() {
    setError(null);
    startTransition(async () => {
      try {
        const response = await requestAnalysisAction({ subjectKind, subjectId });
        if (response.status === "ok") {
          startTransition(() => {
            router.refresh();
          });
        } else {
          setError(analysisErrorMessage(response.error, usage.cap));
        }
      } catch {
        setError(analysisErrorMessage("failed", usage.cap));
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" disabled={pending || !available} onClick={request}>
          {pending ? t.analysis.request.pending : label}
        </Button>
        <span className="text-muted-foreground text-xs">
          {available ? (
            t.analysis.request.usage(usage.used, usage.cap)
          ) : (
            <>
              {t.analysis.request.ownKeyRequired}{" "}
              <Link href="/configuracoes" className="underline-offset-4 hover:underline">
                {t.analysis.request.ownKeyRequiredLink}
              </Link>
              .
            </>
          )}
        </span>
      </div>

      {pending && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}

      {error && <ErrorNotice>{error}</ErrorNotice>}
    </div>
  );
}
