"use client";

import { useId, useState, useSyncExternalStore, useTransition } from "react";

import { ErrorNotice } from "@/components/error-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatDate, formatTime } from "@/lib/format/date-time";
import { cn } from "@/lib/utils";

import type { PreferencesActionResult } from "../actions";
import { archiveDelayText } from "../duration-text";
import { t as preferencesStrings } from "../strings";
import {
  durationMinutes,
  durationOf,
  durationUnits,
  MAX_ARCHIVE_MINUTES,
  type DurationUnit,
  type SuggestionArchive,
  type SuggestionArchiveInput,
} from "../suggestion-archive";

const PRESET_MINUTES = [12 * 60, 24 * 60, 3 * 24 * 60, 7 * 24 * 60] as const;

type Status = "idle" | "saving" | "saved" | "failed";

const MINUTE_MS = 60_000;

function subscribeToMinutes(onTick: () => void): () => void {
  const timer = setInterval(onTick, MINUTE_MS);
  return () => {
    clearInterval(timer);
  };
}

// The example reads the viewer's clock, which the server cannot know: null until hydrated.
function useMinuteClock(): number | null {
  return useSyncExternalStore(
    subscribeToMinutes,
    () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS,
    () => null,
  );
}

function parseAmount(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const amount = Number(text.trim());
  return amount >= 1 ? amount : null;
}

// The action comes from `radar`, which also erases the sightings when the option goes off
// (docs/adr/0074); preferences cannot import radar, which reads it.
export function SuggestionArchivePicker({
  current,
  setAction,
}: {
  current: SuggestionArchive;
  setAction: (input: SuggestionArchiveInput) => Promise<PreferencesActionResult>;
}) {
  const strings = preferencesStrings.suggestionArchive;
  const ids = useId();
  const initial = durationOf(current.afterMinutes);
  const [saved, setSaved] = useState(current);
  const [enabled, setEnabled] = useState(current.enabled);
  const [amountText, setAmountText] = useState(String(initial.amount));
  const [unit, setUnit] = useState<DurationUnit>(initial.unit);
  const [status, setStatus] = useState<Status>("idle");
  const [pending, startTransition] = useTransition();
  const now = useMinuteClock();

  const amount = parseAmount(amountText);
  const draftMinutes = amount === null ? null : durationMinutes({ amount, unit });
  const tooLong = draftMinutes !== null && draftMinutes > MAX_ARCHIVE_MINUTES;
  const draftValid = draftMinutes !== null && !tooLong;
  const dirty = draftValid && draftMinutes !== saved.afterMinutes;
  const shownMinutes = draftValid ? draftMinutes : saved.afterMinutes;
  const fieldError = amount === null ? strings.invalidAmount : tooLong ? strings.tooLong : null;
  const showError = enabled && fieldError !== null;

  function save(next: SuggestionArchive) {
    const previous = saved;
    setEnabled(next.enabled);
    setStatus("saving");
    startTransition(async () => {
      const result = await setAction({
        enabled: next.enabled,
        ...durationOf(next.afterMinutes),
      }).catch(() => null);
      if (result?.status === "ok") {
        setSaved(next);
        setStatus("saved");
      } else {
        setEnabled(previous.enabled);
        showDuration(previous.afterMinutes);
        setStatus("failed");
      }
    });
  }

  function showDuration(minutes: number) {
    const duration = durationOf(minutes);
    setAmountText(String(duration.amount));
    setUnit(duration.unit);
  }

  const unitOptions = durationUnits.map((value) => ({
    value,
    label: amount === 1 ? strings.unitsOne[value] : strings.units[value],
  }));
  const leavesAt = now === null ? null : new Date(now + shownMinutes * MINUTE_MS);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 @min-[52rem]:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] @min-[52rem]:gap-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <Switch
              id={`${ids}-enabled`}
              aria-describedby={`${ids}-hint`}
              checked={enabled}
              disabled={pending}
              onCheckedChange={(next) => {
                save({ enabled: next, afterMinutes: saved.afterMinutes });
              }}
              className="mt-0.5"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <Label htmlFor={`${ids}-enabled`} className="text-sm font-medium">
                {strings.toggle}
              </Label>
              <p id={`${ids}-hint`} className="text-muted-foreground text-xs text-pretty">
                {enabled ? strings.toggleHint : strings.off}
              </p>
            </div>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (dirty) save({ enabled: true, afterMinutes: draftMinutes });
            }}
            className={cn(
              "border-line-soft flex flex-col gap-3 border-t pt-4 transition-opacity duration-[120ms]",
              !enabled && "opacity-50",
            )}
          >
            <div role="group" aria-labelledby={`${ids}-delay`} className="flex flex-col gap-1.5">
              <span id={`${ids}-delay`} className="text-muted-foreground text-xs">
                {strings.delayLabel}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id={`${ids}-amount`}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label={strings.amountLabel}
                  aria-invalid={fieldError !== null}
                  aria-describedby={showError ? `${ids}-error` : undefined}
                  disabled={!enabled || pending}
                  value={amountText}
                  onChange={(event) => {
                    setAmountText(event.target.value);
                    setStatus("idle");
                  }}
                  className="w-16 text-right font-mono tabular-nums"
                />
                <Select
                  items={unitOptions}
                  value={unit}
                  disabled={!enabled || pending}
                  onValueChange={(next) => {
                    const value = durationUnits.find((candidate) => candidate === next);
                    if (value) {
                      setUnit(value);
                      setStatus("idle");
                    }
                  }}
                >
                  <SelectTrigger aria-label={strings.unitLabel} className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {unitOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="submit" size="sm" disabled={!enabled || pending || !dirty}>
                  {status === "saving" ? strings.saving : strings.save}
                </Button>
                <span className="text-muted-foreground text-xs" role="status">
                  {status === "saved" ? strings.saved : ""}
                </span>
              </div>
              {showError && (
                <p id={`${ids}-error`} className="text-destructive text-xs">
                  {fieldError}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground mr-1 text-[11px] tracking-[0.06em] uppercase">
                {strings.presetsLabel}
              </span>
              {PRESET_MINUTES.map((minutes) => {
                const active = enabled && saved.afterMinutes === minutes && !dirty;
                return (
                  <Button
                    key={minutes}
                    type="button"
                    size="xs"
                    variant={active ? "secondary" : "outline"}
                    aria-pressed={active}
                    disabled={!enabled || pending}
                    onClick={() => {
                      showDuration(minutes);
                      save({ enabled: true, afterMinutes: minutes });
                    }}
                    className="font-mono tabular-nums"
                  >
                    {archiveDelayText(minutes)}
                  </Button>
                );
              })}
            </div>
          </form>
        </div>

        <ArchiveTimeline
          enabled={enabled}
          delay={archiveDelayText(shownMinutes)}
          seenAt={now === null ? null : new Date(now)}
          leavesAt={leavesAt}
        />
      </div>

      <p className="text-muted-foreground border-line-soft border-t pt-3 text-xs text-pretty">
        {strings.privacy}
      </p>

      {status === "failed" && <ErrorNotice>{strings.failed}</ErrorNotice>}
    </div>
  );
}

function ArchiveTimeline({
  enabled,
  delay,
  seenAt,
  leavesAt,
}: {
  enabled: boolean;
  delay: string;
  seenAt: Date | null;
  leavesAt: Date | null;
}) {
  const strings = preferencesStrings.suggestionArchive;
  const track = enabled ? "bg-primary/60 h-px" : "border-line border-t border-dashed";
  return (
    <figure
      data-testid="suggestion-archive-example"
      className="border-line-soft bg-muted/30 flex flex-col gap-3 rounded-[var(--radius)] border p-3"
    >
      <figcaption className="text-muted-foreground text-[11px] tracking-[0.06em] uppercase">
        {strings.exampleLabel}
      </figcaption>
      <div className="flex items-center gap-2" aria-hidden>
        <span className="bg-primary size-2 shrink-0 rounded-full" />
        <span className={cn("flex-1", track)} />
        <span
          className={cn(
            "shrink-0 font-mono text-xs tabular-nums",
            enabled ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {enabled ? delay : strings.noDelay}
        </span>
        <span className={cn("flex-1", track)} />
        <span
          className={cn(
            "size-2 shrink-0 rounded-full border",
            enabled ? "border-primary" : "border-line",
          )}
        />
      </div>
      <dl className="flex justify-between gap-4 text-xs">
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground">{strings.seenNow}</dt>
          <dd className="font-mono tabular-nums">{seenAt ? when(seenAt) : "…"}</dd>
        </div>
        <div className="flex flex-col items-end gap-0.5 text-right">
          <dt className="text-muted-foreground">{enabled ? strings.leaves : strings.stays}</dt>
          <dd className="font-mono tabular-nums">
            {!enabled ? "—" : leavesAt ? when(leavesAt) : "…"}
          </dd>
        </div>
      </dl>
    </figure>
  );
}

function when(date: Date): string {
  return preferencesStrings.suggestionArchive.at(formatDate(date), formatTime(date));
}
