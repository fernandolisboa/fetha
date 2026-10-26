import { z } from "zod";

// How long a suggestion the user has already seen stays on "Sugestões de hoje" before it is
// archived for them (docs/adr/0074). `off` keeps every open suggestion on the panel.
export const suggestionArchiveDelays = ["off", "12", "24", "48", "72", "168"] as const;

export type SuggestionArchiveDelay = (typeof suggestionArchiveDelays)[number];

export const suggestionArchiveDelaySchema = z.enum(suggestionArchiveDelays);

export function hoursFromDelay(delay: SuggestionArchiveDelay): number | null {
  return delay === "off" ? null : Number(delay);
}

export function delayFromHours(hours: number | null): SuggestionArchiveDelay {
  return suggestionArchiveDelays.find((delay) => hoursFromDelay(delay) === hours) ?? "off";
}
