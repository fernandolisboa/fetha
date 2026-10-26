"use client";

import { useState, useTransition } from "react";

import { ErrorNotice } from "@/components/error-notice";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import type { PreferencesActionResult } from "../actions";
import { t as preferencesStrings } from "../strings";
import {
  suggestionArchiveDelays,
  suggestionArchiveDelaySchema,
  type SuggestionArchiveDelay,
} from "../suggestion-archive";

// The action comes from `radar`, which also erases the sightings when the option goes off
// (docs/adr/0074); preferences cannot import radar, which reads it.
export function SuggestionArchivePicker({
  current,
  setAction,
}: {
  current: SuggestionArchiveDelay;
  setAction: (delay: SuggestionArchiveDelay) => Promise<PreferencesActionResult>;
}) {
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
          const parsed = suggestionArchiveDelaySchema.safeParse(next);
          if (!parsed.success) return;
          const delay = parsed.data;
          const previous = value;
          setValue(delay);
          setFailed(false);
          startTransition(async () => {
            const result = await setAction(delay).catch(() => null);
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
