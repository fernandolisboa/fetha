"use server";

import { z } from "zod";

import { getDb } from "@/db/client";
import { forCurrentUser, withAuthenticatedAction } from "@/modules/auth";
import {
  getPreferences,
  PreferencesRepository,
  suggestionArchiveInputSchema,
  type PreferencesActionResult,
} from "@/modules/preferences";
import { revalidatePath } from "next/cache";

import { SuggestionSightingsRepository } from "./suggestion-sightings-repository";

// A radar tab lists one session's suggestions, a few dozen at most.
const MAX_SEEN_PER_CALL = 100;

const seenIdsSchema = z.array(z.uuid()).min(1).max(MAX_SEEN_PER_CALL);

export type MarkSuggestionsSeenResult = { status: "ok" } | { status: "error" };

// No revalidation: a sighting only moves a suggestion off the panel after the viewer's delay,
// never while it is on screen. With automatic archiving off nothing is recorded (docs/adr/0074).
export async function markSuggestionsSeenAction(ids: unknown): Promise<MarkSuggestionsSeenResult> {
  const parsed = seenIdsSchema.safeParse(ids);
  if (!parsed.success) return { status: "error" };

  await withAuthenticatedAction(async () => {
    const repository = await forCurrentUser(getDb(), SuggestionSightingsRepository);
    if (!(await getPreferences()).suggestionArchive.enabled) return;
    await repository.markSeen([...new Set(parsed.data)]);
  });
  return { status: "ok" };
}

// docs/adr/0074: turning the option off also erases the user's sightings, which have no purpose
// without it.
export async function setSuggestionArchiveAction(input: unknown): Promise<PreferencesActionResult> {
  const parsed = suggestionArchiveInputSchema.safeParse(input);
  if (!parsed.success) return { status: "error" };

  await withAuthenticatedAction(async () => {
    const db = getDb();
    const preferences = await forCurrentUser(db, PreferencesRepository);
    await preferences.setSuggestionArchive(parsed.data);
    if (!parsed.data.enabled) {
      await (await forCurrentUser(db, SuggestionSightingsRepository)).clear();
    }
  });

  revalidatePath("/", "layout");
  return { status: "ok" };
}
