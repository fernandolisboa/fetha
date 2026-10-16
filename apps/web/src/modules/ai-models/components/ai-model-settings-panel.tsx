"use client";

import { startTransition, useState } from "react";
import {
  analysisModelFamilyChoices,
  analysisSubjectKinds,
  type AiSettingsModelFamilies,
  type AnalysisModelFamilyChoice,
  type AnalysisSubjectKind,
} from "@fetha/contracts";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorNotice } from "@/components/error-notice";

import {
  removeAnthropicApiKeyAction,
  saveAnthropicApiKeyAction,
  setAnalysisModelFamilyAction,
  testAnthropicApiKeyAction,
} from "../actions";
import { modelDisplayName } from "../display-name";
import { t } from "../strings";
import type { ApiKeyStatus } from "../ai-settings-repository";

export function AiModelSettingsPanel({
  modelFamilies,
  apiKey,
  resolvedModels,
}: {
  modelFamilies: AiSettingsModelFamilies;
  apiKey: ApiKeyStatus;
  resolvedModels: Record<AnalysisSubjectKind, string>;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        {analysisSubjectKinds.map((kind) => (
          <FamilyRow
            key={kind}
            kind={kind}
            current={modelFamilies[kind] ?? "default"}
            resolvedModel={resolvedModels[kind]}
          />
        ))}
      </div>
      <ApiKeySection apiKey={apiKey} />
    </div>
  );
}

function FamilyRow({
  kind,
  current,
  resolvedModel,
}: {
  kind: AnalysisSubjectKind;
  current: AnalysisModelFamilyChoice;
  resolvedModel: string;
}) {
  const [value, setValue] = useState<AnalysisModelFamilyChoice>(current);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(next: AnalysisModelFamilyChoice) {
    const previous = value;
    setValue(next);
    setPending(true);
    setError(null);
    startTransition(() => {
      setAnalysisModelFamilyAction({ kind, family: next })
        .then((result) => {
          setPending(false);
          if (result.status === "error") {
            setValue(previous);
            setError(t.apiKey.errors[result.error]);
          }
        })
        .catch(() => {
          setPending(false);
          setValue(previous);
          setError(t.apiKey.errors.unavailable);
        });
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-sm">{t.kinds[kind]}</span>
          <span className="text-muted-foreground font-mono text-xs tabular-nums">
            {t.usingModel(modelDisplayName(resolvedModel))}
          </span>
        </div>
        <Select
          value={value}
          onValueChange={(next) => {
            if (
              typeof next === "string" &&
              (analysisModelFamilyChoices as readonly string[]).includes(next)
            ) {
              submit(next);
            }
          }}
          disabled={pending}
        >
          <SelectTrigger aria-label={t.kinds[kind]} className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {analysisModelFamilyChoices.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {t.families[choice]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
    </div>
  );
}

// Two distinct states, never conflated (#322 review A1): a stored key that
// no longer decrypts says so and is still removable; a missing key says
// plainly that analyses need one (#325) — the server key is never an
// alternative for a user-requested analysis, so it plays no part here.
function statusLine(apiKey: ApiKeyStatus): string {
  if (apiKey.configured && !apiKey.readable) {
    return t.apiKey.unreadable;
  }
  if (apiKey.configured && apiKey.last4) {
    return t.apiKey.ownKey(apiKey.last4);
  }
  return t.apiKey.noKey;
}

function ApiKeySection({ apiKey }: { apiKey: ApiKeyStatus }) {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState(() => statusLine(apiKey));
  // Remove must stay enabled for a stored key even when it no longer
  // decrypts (#322 review A1); testing one is pointless (there is no
  // plaintext to send), so it alone tracks readability too.
  const [stored, setStored] = useState(apiKey.configured);
  const [readable, setReadable] = useState(apiKey.configured && apiKey.readable);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);

  function save() {
    setBusy("save");
    setError(null);
    setMessage(null);
    startTransition(() => {
      saveAnthropicApiKeyAction({ key: input })
        .then((result) => {
          setBusy(null);
          if (result.status === "ok") {
            setInput("");
            setStored(true);
            setReadable(true);
            setStatus(t.apiKey.ownKey(result.last4));
            setMessage(t.apiKey.saved);
          } else if (result.status === "error") {
            setError(t.apiKey.errors[result.error]);
          }
        })
        .catch(() => {
          setBusy(null);
          setError(t.apiKey.errors.unavailable);
        });
    });
  }

  function test() {
    setBusy("test");
    setError(null);
    setMessage(null);
    startTransition(() => {
      testAnthropicApiKeyAction()
        .then((result) => {
          setBusy(null);
          if (result.status === "ok_tested") {
            setMessage(t.apiKey.testOk);
          } else if (result.status === "error") {
            setError(t.apiKey.errors[result.error]);
          }
        })
        .catch(() => {
          setBusy(null);
          setError(t.apiKey.errors.unavailable);
        });
    });
  }

  function remove() {
    setBusy("remove");
    setError(null);
    setMessage(null);
    startTransition(() => {
      removeAnthropicApiKeyAction()
        .then((result) => {
          setBusy(null);
          if (result.status === "ok_removed") {
            setStored(false);
            setReadable(false);
            setStatus(t.apiKey.noKey);
            setMessage(t.apiKey.removed);
          } else if (result.status === "error") {
            setError(t.apiKey.errors[result.error]);
          }
        })
        .catch(() => {
          setBusy(null);
          setError(t.apiKey.errors.unavailable);
        });
    });
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <h3 className="text-sm font-medium">{t.apiKey.title}</h3>
      <p className="text-muted-foreground text-xs">{status}</p>
      <div className="flex items-center gap-2">
        <Label htmlFor="anthropic-api-key" className="sr-only">
          {t.apiKey.title}
        </Label>
        <Input
          id="anthropic-api-key"
          type="password"
          autoComplete="off"
          placeholder={t.apiKey.placeholder}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
          }}
          className="font-mono"
        />
        <Button type="button" onClick={save} disabled={busy !== null || input.trim().length === 0}>
          {busy === "save" ? t.apiKey.saving : t.apiKey.save}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={test}
          disabled={busy !== null || !readable}
        >
          {busy === "test" ? t.apiKey.testing : t.apiKey.test}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={remove}
          disabled={busy !== null || !stored}
        >
          {busy === "remove" ? t.apiKey.removing : t.apiKey.remove}
        </Button>
      </div>
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      {message && !error ? <p className="text-muted-foreground text-xs">{message}</p> : null}
    </div>
  );
}
