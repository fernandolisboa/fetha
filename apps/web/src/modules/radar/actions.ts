"use server";

import { z } from "zod";

import { getDb } from "@/db/client";
import { forCurrentUser, withAuthenticatedAction } from "@/modules/auth";

import { SuggestionSightingsRepository } from "./suggestion-sightings-repository";

// A radar tab lists one session's suggestions, a few dozen at most.
const MAX_SEEN_PER_CALL = 100;

const seenIdsSchema = z.array(z.uuid()).min(1).max(MAX_SEEN_PER_CALL);

export type MarkSuggestionsSeenResult = { status: "ok" } | { status: "error" };

// No revalidation: a sighting only moves a suggestion off the panel after the viewer's delay,
// never while it is on screen.
export async function markSuggestionsSeenAction(ids: unknown): Promise<MarkSuggestionsSeenResult> {
  const parsed = seenIdsSchema.safeParse(ids);
  if (!parsed.success) return { status: "error" };

  await withAuthenticatedAction(async () => {
    const repository = await forCurrentUser(getDb(), SuggestionSightingsRepository);
    await repository.markSeen([...new Set(parsed.data)]);
  });
  return { status: "ok" };
}
