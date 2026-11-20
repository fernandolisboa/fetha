"use client";

import Link from "next/link";
import { startTransition, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/error-notice";

import { savePlanAction, type BuildPlanActionInput, type SavePlanResult } from "../actions";
import { t } from "../strings";

export function SavePlanButton({ input }: { input: BuildPlanActionInput }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SavePlanResult | null>(null);

  if (result?.status === "ok") {
    return (
      <p className="text-[13px]">
        {t.screen.saved}{" "}
        <Link href="/carteira" className="text-primary underline-offset-4 hover:underline">
          {t.screen.goToPortfolio}
        </Link>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        disabled={pending}
        onClick={() => {
          setPending(true);
          startTransition(async () => {
            const next = await savePlanAction(input);
            setResult(next);
            setPending(false);
          });
        }}
      >
        {pending ? t.screen.saving : t.screen.save}
      </Button>
      {result?.status === "error" && <ErrorNotice>{t.screen.errors[result.error]}</ErrorNotice>}
    </div>
  );
}
