import type { ModelFamily } from "@fetha/contracts";

import { matchModelId } from "./model-id";

const FAMILY_NAMES: Record<ModelFamily, string> = {
  haiku: "Haiku",
  sonnet: "Sonnet",
  opus: "Opus",
};

// Generic over every id the resolver can return, so a new major or minor
// release needs no change here ("claude-opus-5-5" -> "Claude Opus 5.5",
// "claude-opus-6" -> "Claude Opus 6"); a dated snapshot shows the same name
// as its undated version. Anything that does not parse falls back to the
// raw id (docs/adr/0068).
export function modelDisplayName(id: string): string {
  const match = matchModelId(id);
  if (!match) {
    return id;
  }
  const version = match.minorSpecified
    ? `${match.major.toString()}.${match.minor.toString()}`
    : match.major.toString();
  return `Claude ${FAMILY_NAMES[match.family]} ${version}`;
}
