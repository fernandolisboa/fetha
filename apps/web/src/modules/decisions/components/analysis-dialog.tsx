"use client";

import type { AnalysisObjectKind } from "@fetha/contracts";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { t } from "../strings";

import { AnalysisPanel, type AnalysisPanelData } from "./analysis-panel";
import { RequestAnalysisButton } from "./request-analysis";

interface AnalysisDialogProps {
  subjectKind: AnalysisObjectKind;
  subjectId: string;
  latest: AnalysisPanelData | null;
  usage: { used: number; cap: number };
  available: boolean;
}

// The per-row "Análise" trigger (DESIGN.md's AnalysisPanel, brief item 3):
// opens the latest accepted analysis, if any, next to the action that asks
// for a new one.
export function AnalysisDialog({
  subjectKind,
  subjectId,
  latest,
  usage,
  available,
}: AnalysisDialogProps) {
  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        {t.analysis.dialog.trigger}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.analysis.dialog.title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {latest && <AnalysisPanel analysis={latest} />}
          <RequestAnalysisButton
            subjectKind={subjectKind}
            subjectId={subjectId}
            hasExistingAnalysis={latest !== null}
            usage={usage}
            available={available}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
