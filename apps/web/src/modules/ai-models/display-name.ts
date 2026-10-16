const FAMILY_NAMES: Record<string, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" };

const MODEL_ID_PATTERN = /^claude-(haiku|sonnet|opus)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/;

// Generic over every id the resolver can return, so a new major or minor
// release needs no change here ("claude-opus-5-5" -> "Claude Opus 5.5",
// "claude-opus-6" -> "Claude Opus 6"); a dated snapshot shows the same name
// as its undated version. Anything that does not parse falls back to the
// raw id (docs/adr/0068).
export function modelDisplayName(id: string): string {
  const match = MODEL_ID_PATTERN.exec(id);
  if (!match) {
    return id;
  }
  const [, family, major, minor] = match;
  if (family === undefined || major === undefined) {
    return id;
  }
  const familyName = FAMILY_NAMES[family];
  if (familyName === undefined) {
    return id;
  }
  const version = minor === undefined ? major : `${major}.${minor}`;
  return `Claude ${familyName} ${version}`;
}
