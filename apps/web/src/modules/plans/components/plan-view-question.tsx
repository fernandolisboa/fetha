"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Ticker } from "@fetha/contracts";

import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { planViews, type PlanView } from "../view";
import { t } from "../strings";

// The asset page's one question (ticket #379): "O que você espera de TICKER nas próximas
// semanas?", answered sobe / cai / fica de lado / não sei, straight to the plan screen.
export function PlanViewQuestion({ ticker }: { ticker: Ticker }) {
  const router = useRouter();
  const [view, setView] = useState<PlanView | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium">
          {t.view.question.replace("{ticker}", ticker)}
        </legend>
        <RadioGroup
          value={view}
          onValueChange={(value) => {
            const next = planViews.find((candidate) => candidate === value);
            if (next) setView(next);
          }}
          className="grid grid-cols-2 gap-2"
        >
          {planViews.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <RadioGroupItem value={option} />
              {t.view.options[option]}
            </label>
          ))}
        </RadioGroup>
      </fieldset>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={view === null}
        onClick={() => {
          if (view) {
            router.push(`/planos/novo?ticker=${ticker}&view=${view}`);
          }
        }}
      >
        {t.view.submit}
      </Button>
    </div>
  );
}
