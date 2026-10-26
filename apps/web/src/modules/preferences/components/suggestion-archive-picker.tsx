"use client";

import { useState, useTransition } from "react";

import { ErrorNotice } from "@/components/error-notice";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { setSuggestionArchiveAction } from "../actions";
import { t as preferencesStrings } from "../strings";
import { suggestionArchiveDelays, type SuggestionArchiveDelay } from "../suggestion-archive";

export function SuggestionArchivePicker({ current }: { current: SuggestionArchiveDelay }) {
  const strings = preferencesStrings.suggestionArchive;
  const [value, setValue] = useState(current);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <RadioGroup
        value={value}
        aria-label={strings.label}
        disabled={pending}
        onValueChange={(next) => {
          const delay = suggestionArchiveDelays.find((candidate) => candidate === next);
          if (!delay) return;
          const previous = value;
          setValue(delay);
          setFailed(false);
          startTransition(async () => {
            const result = await setSuggestionArchiveAction(delay).catch(() => null);
            if (result?.status !== "ok") {
              setValue(previous);
              setFailed(true);
            }
          });
        }}
        className="grid grid-cols-1 gap-2 @min-[32rem]:grid-cols-3"
      >
        {suggestionArchiveDelays.map((delay) => (
          <label key={delay} className="flex items-center gap-2 text-sm">
            <RadioGroupItem value={delay} />
            {strings.options[delay]}
          </label>
        ))}
      </RadioGroup>
      {failed && <ErrorNotice>{strings.failed}</ErrorNotice>}
    </div>
  );
}
