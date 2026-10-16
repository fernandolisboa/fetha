import { pinnedModels } from "@fetha/prompts";
import type { ModelFamily } from "@fetha/contracts";

import { matchModelId } from "./model-id";

export interface CatalogModelInfo {
  id: string;
  createdAt: Date;
}

interface ParsedModelId {
  id: string;
  family: ModelFamily;
  major: number;
  minor: number;
  dated: boolean;
  createdAt: Date;
}

// Any model outside the three allowed families (Fable, Mythos...) never
// matches `matchModelId`, so it is silently ignored rather than picked
// (docs/adr/0068).
function parseModelId(id: string, createdAt: Date): ParsedModelId | null {
  const match = matchModelId(id);
  if (!match) {
    return null;
  }
  return {
    id,
    family: match.family,
    major: match.major,
    minor: match.minor,
    dated: match.dated,
    createdAt,
  };
}

// a is newer than b: higher major, then higher minor, then newer createdAt,
// then (everything else tied) the undated alias over a dated snapshot.
function isNewer(a: ParsedModelId, b: ParsedModelId): boolean {
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  const aTime = a.createdAt.getTime();
  const bTime = b.createdAt.getTime();
  if (aTime !== bTime) return aTime > bTime;
  return b.dated && !a.dated;
}

// Picks the newest id of `family` out of a model listing, never older than
// `pinnedId` (default: that family's pinned floor). An empty or
// non-matching listing, or one where nothing beats the pin, answers the pin
// itself (docs/adr/0068).
export function newestOfFamily(
  models: readonly CatalogModelInfo[],
  family: ModelFamily,
  pinnedId: string = pinnedModels[family],
): string {
  const pinnedParsed = parseModelId(pinnedId, new Date(0));
  if (!pinnedParsed) {
    throw new Error(`pinned model id "${pinnedId}" does not parse as a Claude model id`);
  }

  let best: ParsedModelId | null = null;
  for (const model of models) {
    const parsed = parseModelId(model.id, model.createdAt);
    if (!parsed || parsed.family !== family) {
      continue;
    }
    if (best === null || isNewer(parsed, best)) {
      best = parsed;
    }
  }

  if (best === null || !isNewer(best, pinnedParsed)) {
    return pinnedId;
  }
  return best.id;
}
