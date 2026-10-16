"use client";

import { startTransition, useState } from "react";
import type {
  AiSettingsModelFamilies,
  AnalysisModelFamilyChoice,
  AnalysisSubjectKind,
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

const KINDS: readonly AnalysisSubjectKind[] = [
  "signal",
  "contemplated_operation",
  "held_operation",
  "backtest_run",
  "suggestion",
];

const CHOICES: readonly AnalysisModelFamilyChoice[] = ["default", "haiku", "sonnet", "opus"];

export function AiModelSettingsPanel({
  modelFamilies,
  apiKey,
  serverKeyConfigured,
  resolvedModels,
}: {
  modelFamilies: AiSettingsModelFamilies;
  apiKey: ApiKeyStatus;
  serverKeyConfigured: boolean;
  resolvedModels: Record<AnalysisSubjectKind, string>;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        {KINDS.map((kind) => (
          <FamilyRow
            key={kind}
            kind={kind}
            current={modelFamilies[kind] ?? "default"}
            resolvedModel={resolvedModels[kind]}
          />
        ))}
      </div>
      <ApiKeySection apiKey={apiKey} serverKeyConfigured={serverKeyConfigured} />
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

  function submit(next: AnalysisModelFamilyChoice) {
    setValue(next);
    setPending(true);
    startTransition(() => {
      setAnalysisModelFamilyAction({ kind, family: next })
        .then(() => {
          setPending(false);
        })
        .catch(() => {
          setPending(false);
        });
    });
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col">
        <span className="text-sm">{t.kinds[kind]}</span>
        <span className="text-muted-foreground font-mono text-xs">
          {t.usingModel(modelDisplayName(resolvedModel))}
        </span>
      </div>
      <Select
        value={value}
        onValueChange={(next) => {
          if (typeof next === "string" && (CHOICES as readonly string[]).includes(next)) {
            submit(next);
          }
        }}
        disabled={pending}
      >
        <SelectTrigger aria-label={t.kinds[kind]} className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CHOICES.map((choice) => (
            <SelectItem key={choice} value={choice}>
              {t.families[choice]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function statusLine(apiKey: ApiKeyStatus, serverKeyConfigured: boolean): string {
  if (apiKey.configured && !apiKey.readable) {
    return t.apiKey.unreadable;
  }
  if (apiKey.configured && apiKey.last4) {
    return t.apiKey.ownKey(apiKey.last4);
  }
  return serverKeyConfigured ? t.apiKey.serverKey : t.apiKey.unreadable;
}

function ApiKeySection({
  apiKey,
  serverKeyConfigured,
}: {
  apiKey: ApiKeyStatus;
  serverKeyConfigured: boolean;
}) {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState(() => statusLine(apiKey, serverKeyConfigured));
  const [configured, setConfigured] = useState(apiKey.configured && apiKey.readable);
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
            setConfigured(true);
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
            setConfigured(false);
            setStatus(serverKeyConfigured ? t.apiKey.serverKey : t.apiKey.unreadable);
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
          disabled={busy !== null || !configured}
        >
          {busy === "test" ? t.apiKey.testing : t.apiKey.test}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={remove}
          disabled={busy !== null || !configured}
        >
          {busy === "remove" ? t.apiKey.removing : t.apiKey.remove}
        </Button>
      </div>
      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
      {message && !error ? <p className="text-muted-foreground text-xs">{message}</p> : null}
    </div>
  );
}
