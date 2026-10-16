import type { ModelFamily } from "@fetha/contracts";

export interface ModelIdMatch {
  family: ModelFamily;
  major: number;
  minor: number;
  minorSpecified: boolean;
  dated: boolean;
}

// Matches a Claude model id of one of the three allowed families: a bare
// major ("claude-opus-6"), a major.minor ("claude-opus-5-5") or a dated
// snapshot of either ("claude-opus-5-5-20260815"). Any other model (Fable,
// Mythos, anything outside these three families) never matches. Shared by
// the resolver (ranks listed ids) and the display name (renders one id) so
// a future id shape needs one change (#322 review A10).
const MODEL_ID_PATTERN = /^claude-(haiku|sonnet|opus)-(\d+)(?:-(\d{1,2}))?(?:-(\d{8}))?$/;

export function matchModelId(id: string): ModelIdMatch | null {
  const match = MODEL_ID_PATTERN.exec(id);
  if (!match) {
    return null;
  }
  const [, family, majorRaw, minorRaw, dateRaw] = match;
  if (family === undefined || majorRaw === undefined) {
    return null;
  }
  return {
    family: family as ModelFamily,
    major: Number.parseInt(majorRaw, 10),
    minor: minorRaw === undefined ? 0 : Number.parseInt(minorRaw, 10),
    minorSpecified: minorRaw !== undefined,
    dated: dateRaw !== undefined,
  };
}
