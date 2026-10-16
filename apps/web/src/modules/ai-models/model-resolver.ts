import { pinnedModels } from "@fetha/prompts";
import type { ModelFamily } from "@fetha/contracts";

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

// Matches a Claude model id of one of the three allowed families: a bare
// major ("claude-opus-6"), a major.minor ("claude-opus-5-5") or a dated
// snapshot of either ("claude-opus-5-5-20260815"). Any other model (Fable,
// Mythos, anything outside these three families) never matches, so it is
// silently ignored rather than picked (docs/adr/0068).
const MODEL_ID_PATTERN = /^claude-(haiku|sonnet|opus)-(\d+)(?:-(\d{1,2}))?(?:-(\d{8}))?$/;

function parseModelId(id: string, createdAt: Date): ParsedModelId | null {
  const match = MODEL_ID_PATTERN.exec(id);
  if (!match) {
    return null;
  }
  const [, family, majorRaw, minorRaw, dateRaw] = match;
  if (family === undefined || majorRaw === undefined) {
    return null;
  }
  return {
    id,
    family: family as ModelFamily,
    major: Number.parseInt(majorRaw, 10),
    minor: minorRaw === undefined ? 0 : Number.parseInt(minorRaw, 10),
    dated: dateRaw !== undefined,
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
