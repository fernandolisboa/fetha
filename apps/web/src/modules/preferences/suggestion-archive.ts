import { z } from "zod";

// docs/adr/0074: whether a suggestion the user has already seen leaves their "Sugestões de hoje",
// and how long after the first sighting. Stored in minutes; the screen speaks in the largest unit
// that divides it exactly.
export const durationUnits = ["minutes", "hours", "days", "weeks"] as const;

export type DurationUnit = (typeof durationUnits)[number];

const MINUTES_PER: Record<DurationUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 60 * 24,
  weeks: 60 * 24 * 7,
};

export const MAX_ARCHIVE_MINUTES = 365 * MINUTES_PER.days;
export const DEFAULT_ARCHIVE_MINUTES = MINUTES_PER.days;

export interface SuggestionArchive {
  enabled: boolean;
  afterMinutes: number;
}

export interface Duration {
  amount: number;
  unit: DurationUnit;
}

export function durationMinutes({ amount, unit }: Duration): number {
  return amount * MINUTES_PER[unit];
}

export function durationOf(minutes: number): Duration {
  const unit = [...durationUnits].reverse().find((candidate) => {
    return minutes % MINUTES_PER[candidate] === 0;
  });
  return unit
    ? { amount: minutes / MINUTES_PER[unit], unit }
    : { amount: minutes, unit: "minutes" };
}

export function isValidArchiveMinutes(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_ARCHIVE_MINUTES;
}

export const suggestionArchiveInputSchema = z
  .strictObject({
    enabled: z.boolean(),
    amount: z.number().int().min(1),
    unit: z.enum(durationUnits),
  })
  .transform(({ enabled, amount, unit }) => ({
    enabled,
    afterMinutes: durationMinutes({ amount, unit }),
  }))
  .refine(({ afterMinutes }) => afterMinutes <= MAX_ARCHIVE_MINUTES);

export type SuggestionArchiveInput = z.input<typeof suggestionArchiveInputSchema>;

// A stored value outside the range (a database edited by hand) reads as the default delay.
export function storedSuggestionArchive(enabled: boolean, minutes: number): SuggestionArchive {
  return {
    enabled,
    afterMinutes: isValidArchiveMinutes(minutes) ? minutes : DEFAULT_ARCHIVE_MINUTES,
  };
}

export function archiveAfterMinutes(archive: SuggestionArchive): number | null {
  return archive.enabled ? archive.afterMinutes : null;
}
