"use client";

import { startTransition, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { triggerNightlyJobAction, type TriggerNightlyJobResult } from "../actions";
import { t } from "../strings";

function sourceStatusLabel(source: { skipped: boolean; error?: string }): string {
  if (source.error !== undefined) {
    return t.panel.sourceFailed;
  }
  if (source.skipped) {
    return t.panel.sourceSkipped;
  }
  return t.panel.sourceOk;
}

export function NightlyTriggerPanel() {
  const [session, setSession] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<TriggerNightlyJobResult | null>(null);

  function submit() {
    setPending(true);
    startTransition(() => {
      triggerNightlyJobAction({ session: session.trim() === "" ? undefined : session })
        .then((response) => {
          setPending(false);
          setResult(response);
        })
        .catch(() => {
          setPending(false);
          setResult(null);
        });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nightly-session">{t.panel.sessionLabel}</Label>
        <Input
          id="nightly-session"
          type="date"
          value={session}
          placeholder={t.panel.sessionPlaceholder}
          onChange={(event) => {
            setSession(event.target.value);
          }}
        />
      </div>

      <div>
        <Button onClick={submit} disabled={pending}>
          {pending ? t.panel.running : t.panel.submit}
        </Button>
      </div>

      {result ? (
        <div className="border-border bg-muted/30 flex flex-col gap-2 rounded-[var(--radius)] border p-3 text-xs">
          <h3 className="text-sm font-medium">{t.panel.resultTitle}</h3>
          {result.status === "forbidden" ? <p>{t.panel.forbidden}</p> : null}
          {result.status === "invalid_input" ? <p>{t.panel.invalidInput}</p> : null}
          {result.status === "ok" ? (
            <div className="flex flex-col gap-1">
              <p>{result.outcome.ok ? t.panel.ok : t.panel.failed}</p>
              <p>
                {t.panel.session}: {result.outcome.session ?? "—"}
              </p>
              <ul className="flex flex-col gap-0.5">
                {result.outcome.sources.map((source) => (
                  <li key={source.source}>
                    {source.source}: {sourceStatusLabel(source)}
                  </li>
                ))}
              </ul>
              <p>
                {result.outcome.evaluation
                  ? t.panel.signalsWritten(result.outcome.evaluation.signalsWritten)
                  : t.panel.evaluationSkipped}
              </p>
              <p>{t.panel.decisionsScored(result.outcome.scoring.decisionsScored)}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
