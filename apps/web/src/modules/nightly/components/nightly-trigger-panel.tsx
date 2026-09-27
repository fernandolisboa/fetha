"use client";

import { startTransition, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format/date-time";
import { sessionDateToDisplayDate } from "@/modules/market-data/client";

import { triggerNightlyJobAction, type TriggerNightlyJobResult } from "../actions";
import { t } from "../strings";

type PanelResult = TriggerNightlyJobResult | { status: "client_error" };

function sourceStatusLabel(status: "ok" | "skipped" | "failed"): string {
  switch (status) {
    case "ok":
      return t.panel.sourceOk;
    case "skipped":
      return t.panel.sourceSkipped;
    case "failed":
      return t.panel.sourceFailed;
  }
}

function ResultBody({ result }: { result: PanelResult }) {
  switch (result.status) {
    case "forbidden":
      return <p>{t.panel.forbidden}</p>;
    case "invalid_input":
      return <p>{t.panel.invalidInput}</p>;
    case "busy":
      return <p>{t.panel.busy}</p>;
    case "client_error":
      return <p>{t.panel.unexpectedError}</p>;
    case "ok":
      return (
        <div className="flex flex-col gap-1">
          <p>{result.summary.ok ? t.panel.ok : t.panel.failed}</p>
          <p>
            {t.panel.session}:{" "}
            {result.summary.session
              ? formatDate(sessionDateToDisplayDate(result.summary.session))
              : "—"}
          </p>
          <div>
            <p className="text-muted-foreground">{t.panel.sources}</p>
            <ul className="flex flex-col gap-0.5">
              {result.summary.sources.map((source) => (
                <li key={source.source}>
                  {source.source}: {sourceStatusLabel(source.status)}
                </li>
              ))}
            </ul>
          </div>
          <p>
            {result.summary.signalsWritten === null
              ? t.panel.evaluationSkipped
              : t.panel.signalsWritten(result.summary.signalsWritten)}
          </p>
          <p>{t.panel.decisionsScored(result.summary.decisionsScored)}</p>
        </div>
      );
  }
}

export function NightlyTriggerPanel() {
  const [session, setSession] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<PanelResult | null>(null);

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
          setResult({ status: "client_error" });
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
          <ResultBody result={result} />
        </div>
      ) : null}
    </div>
  );
}
